import { Address, defineChain } from "viem";
import { lineaEstimateGas } from "~~/utils/lineaGas";

/**
 * Status Network Hoodi Testnet (L2). Sepolia-based Status testnet is being
 * sunset in favor of Hoodi as of April 2026.
 *
 * We wire `fees.estimateFeesPerGas` to call `linea_estimateGas` directly so
 * viem/wagmi:
 *   - don't rely on standard `eth_gasPrice` / `eth_maxPriorityFeePerGas`
 *     (which miss Linea's L2 pricing and Status's Karma adjustments), and
 *   - pick up the gasless path automatically for eligible senders (base and
 *     priority fees come back as 0, so the wallet doesn't try to price in
 *     non-existent ETH on fresh stealth addresses).
 *
 * Per the Status docs, `from` MUST be included in the request — without it
 * the node can't apply Karma/quota/deny-list logic.
 *
 * https://docs.status.network/build-for-karma/guides/gasless-integration
 */
export const statusHoodi = defineChain({
  id: 374,
  name: "Status Network Hoodi",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://public.hoodi.rpc.status.network"] },
  },
  blockExplorers: {
    default: { name: "Hoodiscan", url: "https://hoodiscan.status.network" },
  },
  contracts: {
    multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" },
  },
  testnet: true,
  fees: {
    async estimateFeesPerGas({ client, request, type, multiply }) {
      // `from` is required for Karma-aware fee estimation on Status.
      const account = request?.account as { address?: Address } | Address | undefined;
      const from: Address | undefined =
        typeof account === "string" ? account : (account?.address as Address | undefined);
      if (!from) return null;

      try {
        const result = await lineaEstimateGas(client, {
          from,
          to: request?.to as Address | undefined,
          value: request?.value as bigint | undefined,
          data: request?.data as `0x${string}` | undefined,
        });

        const baseFeePerGas = multiply(BigInt(result.baseFeePerGas));
        const maxPriorityFeePerGas = BigInt(result.priorityFeePerGas);
        const maxFeePerGas = baseFeePerGas + maxPriorityFeePerGas;

        if (type === "legacy") return { gasPrice: maxFeePerGas };
        return { maxFeePerGas, maxPriorityFeePerGas };
      } catch {
        // Fall back to viem's default fee estimation on transient failures.
        return null;
      }
    },
  },
});

/**
 * Canonical addresses of the Status Network Karma stack on Hoodi.
 * These are fixed by Status Network and not deployed by us.
 * https://docs.status.network/general-info/contract-addresses/testnet-contracts
 */
export const STATUS_HOODI_KARMA = {
  karma: "0x0700be6f329cc48c38144f71c898b72795db6c1b",
  karmaTiers: "0xb8039632e089dcefa6bbb1590948926b2463b691",
  rln: "0x420077c98880a9ebb45296cf7721ab7a5b56bd47",
  stakeManager: "0x2bc5b2a5f580064aab6fbc1ee30113cd808582ac",
} as const;
