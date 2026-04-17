import { Address, Hex, encodeFunctionData, hexToBigInt, numberToHex } from "viem";

/**
 * Minimal surface we need from any viem Client / PublicClient — just the JSON-RPC
 * transport. viem narrows `request` to a discriminated union keyed by the known
 * RPC methods in its schema; `linea_estimateGas` is not in that schema so we
 * intentionally accept any client and cast the call inside.
 */
// viem's `Client["request"]` is a discriminated union keyed on the RPC method.
// `linea_estimateGas` isn't in its default schema, so we accept any request
// function here and pass the method name through by intention.
export type LineaGasCapableClient = { request: (args: any) => Promise<any> };

/**
 * Raw response shape of `linea_estimateGas` on Status Network (and Linea).
 *
 * Status extends Linea's RPC: the fee fields incorporate the sender's Karma
 * state. Gasless-eligible senders get zero base + priority fees; deny-listed
 * senders get premium multipliers applied.
 *
 * Docs:
 *   - https://docs.status.network/build-for-karma/guides/gasless-integration
 *   - https://docs.linea.build/api/reference/linea-estimategas
 */
export type LineaEstimateGasResult = {
  gasLimit: Hex;
  baseFeePerGas: Hex;
  priorityFeePerGas: Hex;
};

export type LineaEstimateGasCall = {
  from: Address;
  to?: Address;
  value?: bigint;
  data?: Hex;
};

/**
 * Derived view over a `linea_estimateGas` result, with EIP-1559 fields pre-built
 * and the two Karma-driven outcomes (gasless / premium) surfaced as booleans.
 */
export type LineaGasQuote = {
  gas: bigint;
  baseFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  maxFeePerGas: bigint;
  /** True when Status gave this sender zero base + priority fees (Karma quota). */
  isGasless: boolean;
  /**
   * Heuristic: meaningfully higher fees than a "normal" L2 suggest a premium /
   * deny-list multiplier. Only used for UX copy, never for tx logic.
   */
  isPremium: boolean;
  raw: LineaEstimateGasResult;
};

const PREMIUM_BASE_FEE_GWEI_THRESHOLD = 5n * 10n ** 9n; // 5 gwei — anything above is "premium" on a gasless L2

/**
 * Low-level wrapper: call `linea_estimateGas` with the shape Status expects.
 * The `from` parameter is mandatory — without it the node cannot apply
 * Karma / quota / deny-list logic and you'll get wrong fees.
 */
export const lineaEstimateGas = async (
  client: LineaGasCapableClient,
  call: LineaEstimateGasCall,
): Promise<LineaEstimateGasResult> => {
  const params: {
    from: Address;
    to?: Address;
    value?: Hex;
    data?: Hex;
  } = { from: call.from };
  if (call.to) params.to = call.to;
  if (call.value !== undefined) params.value = numberToHex(call.value);
  if (call.data) params.data = call.data;

  const result = await client.request({ method: "linea_estimateGas", params: [params] });
  return result as LineaEstimateGasResult;
};

/**
 * Estimate gas + fees for a generic call and return an EIP-1559-ready quote.
 *
 * Status's gasless path occasionally returns `gasLimit = 0x0`. That's a valid
 * "no fee owed" signal but useless as the tx's `gas` field — every tx needs
 * at least the intrinsic gas (21,000). When that happens we fall back to
 * `eth_estimateGas` for the gas limit and keep Status's Karma-aware fees.
 */
export const lineaGasQuote = async (
  client: LineaGasCapableClient,
  call: LineaEstimateGasCall,
): Promise<LineaGasQuote> => {
  const raw = await lineaEstimateGas(client, call);
  let gas = hexToBigInt(raw.gasLimit);
  const baseFeePerGas = hexToBigInt(raw.baseFeePerGas);
  const maxPriorityFeePerGas = hexToBigInt(raw.priorityFeePerGas);
  const maxFeePerGas = baseFeePerGas + maxPriorityFeePerGas;
  const isGasless = baseFeePerGas === 0n && maxPriorityFeePerGas === 0n;
  const isPremium = !isGasless && baseFeePerGas > PREMIUM_BASE_FEE_GWEI_THRESHOLD;

  if (gas === 0n) {
    try {
      const ethParams: { from: Address; to?: Address; value?: Hex; data?: Hex } = { from: call.from };
      if (call.to) ethParams.to = call.to;
      if (call.value !== undefined) ethParams.value = numberToHex(call.value);
      if (call.data) ethParams.data = call.data;
      const ethEst = (await client.request({ method: "eth_estimateGas", params: [ethParams] })) as Hex;
      gas = hexToBigInt(ethEst);
    } catch {
      // Leave gas as 0; downstream callers handle this (e.g. by omitting the
      // override so viem backfills internally).
    }
  }

  return { gas, baseFeePerGas, maxPriorityFeePerGas, maxFeePerGas, isGasless, isPremium, raw };
};

/**
 * Sugar: encode a contract call into calldata and estimate. Prefer this over
 * calling `lineaGasQuote` by hand so the `data` bytes never drift from what
 * the tx will actually carry.
 */
export const lineaContractGasQuote = async <TAbi extends readonly unknown[]>(
  client: LineaGasCapableClient,
  args: {
    from: Address;
    address: Address;
    abi: TAbi;
    functionName: string;
    args?: readonly unknown[];
    value?: bigint;
  },
): Promise<LineaGasQuote> => {
  const data = encodeFunctionData({
    abi: args.abi,
    functionName: args.functionName,
    args: args.args,
  } as never) as Hex;
  return lineaGasQuote(client, { from: args.from, to: args.address, value: args.value, data });
};

/**
 * Convenience: the fee fields in the exact shape viem's `writeContract` /
 * `sendTransaction` expect. Always re-quote near send time — the guide is
 * explicit that sender Karma state can change between quote and submit.
 *
 * NOTE: Status's gasless path sometimes returns `gasLimit = 0` in addition
 * to zero fees. That's fine as a signal but can't be forwarded as the tx's
 * `gas` field — the node demands at least the intrinsic gas (21,000). When
 * gas is 0 we omit it so viem will backfill via `eth_estimateGas`, while
 * keeping the Karma-aware fee values so the tx still lands on the gasless
 * tier.
 */
export const toFeeOverrides = (
  quote: LineaGasQuote,
): { gas?: bigint; maxFeePerGas: bigint; maxPriorityFeePerGas: bigint } => {
  const overrides: { gas?: bigint; maxFeePerGas: bigint; maxPriorityFeePerGas: bigint } = {
    maxFeePerGas: quote.maxFeePerGas,
    maxPriorityFeePerGas: quote.maxPriorityFeePerGas,
  };
  if (quote.gas > 0n) overrides.gas = quote.gas;
  return overrides;
};
