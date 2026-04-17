import { Address, Hex, concat, createWalletClient, http, keccak256, toHex } from "viem";
import { PrivateKeyAccount, privateKeyToAccount } from "viem/accounts";
import type { Chain } from "viem/chains";

/**
 * Deterministic stealth-wallet derivation for BucketLending.
 *
 * Flow:
 *   1. The user signs `stealthSigningMessage(mainAddress)` with their primary wallet.
 *   2. We hash that signature to get a 32-byte root seed (never leaves the browser).
 *   3. The stealth private key for index N is keccak256(seed || "stealth" || N).
 *
 * Properties:
 *   - Same main wallet + same version constant ⇒ identical stealth addresses across devices.
 *   - Changing the version constant rotates the entire stealth tree.
 *   - Seed lives in sessionStorage only; cleared when the tab closes.
 *   - localStorage only tracks the highest-used index so we can rehydrate the list
 *     of known addresses without re-signing (address derivation still needs the seed).
 */

export const STEALTH_SIG_VERSION = "v1";

export const stealthSigningMessage = (mainAddress: Address) =>
  `BucketLending Stealth Seed ${STEALTH_SIG_VERSION}\nIdentity: ${mainAddress.toLowerCase()}`;

export const seedFromSignature = (signature: Hex): Hex => keccak256(signature);

const INDEX_PREFIX = toHex("stealth", { size: 8 });

export const derivePrivateKey = (seed: Hex, index: number): Hex => {
  const indexBytes = toHex(BigInt(index), { size: 4 });
  return keccak256(concat([seed, INDEX_PREFIX, indexBytes]));
};

export type StealthAccount = {
  index: number;
  address: Address;
  account: PrivateKeyAccount;
};

export const deriveStealthAccount = (seed: Hex, index: number): StealthAccount => {
  const pk = derivePrivateKey(seed, index);
  const account = privateKeyToAccount(pk);
  return { index, address: account.address, account };
};

export const deriveRange = (seed: Hex, count: number): StealthAccount[] => {
  const out: StealthAccount[] = [];
  for (let i = 0; i < count; i++) out.push(deriveStealthAccount(seed, i));
  return out;
};

const seedKey = (mainAddress: Address) => `bl:seed:${mainAddress.toLowerCase()}`;
const countKey = (mainAddress: Address) => `bl:stealthCount:${mainAddress.toLowerCase()}`;

export const loadStoredSeed = (mainAddress: Address): Hex | null => {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(seedKey(mainAddress));
  return raw && raw.startsWith("0x") ? (raw as Hex) : null;
};

export const storeSeed = (mainAddress: Address, seed: Hex) => {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(seedKey(mainAddress), seed);
};

export const clearStoredSeed = (mainAddress: Address) => {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(seedKey(mainAddress));
};

export const loadStealthCount = (mainAddress: Address): number => {
  if (typeof window === "undefined") return 0;
  const raw = window.localStorage.getItem(countKey(mainAddress));
  if (!raw) return 0;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

export const storeStealthCount = (mainAddress: Address, count: number) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(countKey(mainAddress), String(count));
};

/**
 * Build a viem wallet client that signs and broadcasts from a specific stealth
 * account. Status Network is gasless so no funding step is required.
 */
export const createStealthWalletClient = (stealth: StealthAccount, chain: Chain, rpcUrl: string) =>
  createWalletClient({
    account: stealth.account,
    chain,
    transport: http(rpcUrl),
  });
