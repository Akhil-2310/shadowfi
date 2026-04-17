import { Address, PublicClient, WalletClient } from "viem";
import { LineaGasQuote } from "~~/utils/lineaGas";

/**
 * Design note: why this exists.
 *
 * The stealth addresses we borrow / repay from start with 0 ETH and 0 Karma.
 * Status Network's gasless path on `linea_estimateGas` is Karma-aware:
 *   - eligible senders come back with baseFeePerGas + priorityFeePerGas == 0
 *     (true gasless) and the stealth can submit with no balance.
 *   - non-eligible senders (which includes many fresh addresses without Karma
 *     quota) come back with real fees, and the sequencer rejects a tx whose
 *     `gas * maxFeePerGas + value` exceeds the sender balance.
 *
 * To keep the app usable even when the stealth is NOT gasless, we fall back
 * to a minimal ETH top-up from the primary wallet. This does create a 1-hop
 * onchain link (primary -> that specific stealth), which is a real privacy
 * tradeoff — but it only leaks this particular stealth, not the user's full
 * loan set, and we surface it in the UI. The fully-private path is only
 * active when Status returns a gasless quote.
 */

export type EnsureStealthGasResult = {
  /** True when we actually sent a top-up transaction from the main wallet. */
  funded: boolean;
  /** Amount transferred to the stealth from the main wallet, if any. */
  topUp: bigint;
  /** Total required = gas * maxFeePerGas + extraValue. */
  required: bigint;
  /** Stealth balance observed before any top-up. */
  stealthBalance: bigint;
};

/**
 * Make sure the stealth address can afford `gas * maxFeePerGas + extraValue`.
 * - If the quote is fully gasless we skip everything (the preferred path).
 * - Otherwise we top up the exact deficit from the connected main wallet.
 *
 * `extraValue` is the `msg.value` the upcoming tx will send (e.g. the owed
 * amount on repay). For non-payable calls pass `0n`.
 */
export const ensureStealthGas = async ({
  publicClient,
  mainWalletClient,
  stealth,
  quote,
  extraValue = 0n,
}: {
  publicClient: PublicClient;
  mainWalletClient: WalletClient;
  stealth: Address;
  quote: LineaGasQuote;
  extraValue?: bigint;
}): Promise<EnsureStealthGasResult> => {
  const required = quote.gas * quote.maxFeePerGas + extraValue;

  // Gasless path: nothing to do. Stealth submits with maxFeePerGas=0 and the
  // Status sequencer waives the fee at submit time.
  if (required === 0n) {
    return { funded: false, topUp: 0n, required: 0n, stealthBalance: 0n };
  }

  const stealthBalance = await publicClient.getBalance({ address: stealth });
  if (stealthBalance >= required) {
    return { funded: false, topUp: 0n, required, stealthBalance };
  }

  const topUp = required - stealthBalance;

  const mainAccount = mainWalletClient.account;
  if (!mainAccount) {
    throw new Error("Main wallet is not connected — cannot top up stealth gas.");
  }
  const chain = mainWalletClient.chain;
  if (!chain) {
    throw new Error("Main wallet has no chain context — reconnect your wallet.");
  }

  const hash = await mainWalletClient.sendTransaction({
    account: mainAccount,
    chain,
    to: stealth,
    value: topUp,
  });
  await publicClient.waitForTransactionReceipt({ hash });

  return { funded: true, topUp, required, stealthBalance };
};
