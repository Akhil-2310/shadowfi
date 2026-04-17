import { GenericContractsDeclaration } from "~~/utils/scaffold-eth/contract";

/**
 * Canonical Status Network contracts we rely on but do NOT deploy ourselves.
 * On local hardhat we ship a `MockKarma` under `deployedContracts.ts` that
 * exposes the same `balanceOf` read surface so the UI is drop-in compatible
 * across both networks.
 *
 * Source: https://docs.status.network/general-info/contract-addresses/testnet-contracts
 */
const externalContracts = {
  374: {
    Karma: {
      address: "0x0700be6f329cc48c38144f71c898b72795db6c1b",
      abi: [
        {
          inputs: [{ name: "account", type: "address" }],
          name: "balanceOf",
          outputs: [{ name: "", type: "uint256" }],
          stateMutability: "view",
          type: "function",
        },
        {
          inputs: [{ name: "account", type: "address" }],
          name: "slashedAmountOf",
          outputs: [{ name: "", type: "uint256" }],
          stateMutability: "view",
          type: "function",
        },
        {
          inputs: [],
          name: "name",
          outputs: [{ name: "", type: "string" }],
          stateMutability: "view",
          type: "function",
        },
        {
          inputs: [],
          name: "symbol",
          outputs: [{ name: "", type: "string" }],
          stateMutability: "view",
          type: "function",
        },
        {
          inputs: [],
          name: "decimals",
          outputs: [{ name: "", type: "uint8" }],
          stateMutability: "view",
          type: "function",
        },
      ],
    },
    KarmaTiers: {
      address: "0xb8039632e089dcefa6bbb1590948926b2463b691",
      abi: [
        {
          inputs: [{ name: "karmaBalance", type: "uint256" }],
          name: "getTierIdByKarmaBalance",
          outputs: [{ name: "", type: "uint8" }],
          stateMutability: "view",
          type: "function",
        },
        {
          inputs: [{ name: "tierId", type: "uint8" }],
          name: "getTierById",
          outputs: [
            {
              components: [
                { name: "minKarma", type: "uint256" },
                { name: "maxKarma", type: "uint256" },
                { name: "name", type: "string" },
                { name: "txPerEpoch", type: "uint32" },
              ],
              name: "",
              type: "tuple",
            },
          ],
          stateMutability: "view",
          type: "function",
        },
        {
          inputs: [],
          name: "getTierCount",
          outputs: [{ name: "", type: "uint256" }],
          stateMutability: "view",
          type: "function",
        },
      ],
    },
  },
} as const;

export default externalContracts satisfies GenericContractsDeclaration;
