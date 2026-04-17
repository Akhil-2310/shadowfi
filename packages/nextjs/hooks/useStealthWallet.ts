"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Address, Hex, WalletClient, http } from "viem";
import { useAccount, usePublicClient, useSignMessage } from "wagmi";
import { useTargetNetwork } from "~~/hooks/scaffold-eth";
import scaffoldConfig from "~~/scaffold.config";
import {
  StealthAccount,
  clearStoredSeed,
  createStealthWalletClient,
  deriveRange,
  deriveStealthAccount,
  loadStealthCount,
  loadStoredSeed,
  seedFromSignature,
  stealthSigningMessage,
  storeSeed,
  storeStealthCount,
} from "~~/utils/stealth";

type State = {
  seed: Hex | null;
  count: number;
};

/**
 * Client-side management of deterministic stealth wallets derived from a
 * signature over the user's primary wallet. Seed lives in sessionStorage;
 * addresses survive across sessions via a persisted count.
 */
export const useStealthWallet = () => {
  const { address: mainAddress } = useAccount();
  const { signMessageAsync, isPending: isSigning } = useSignMessage();
  const { targetNetwork } = useTargetNetwork();
  const publicClient = usePublicClient({ chainId: targetNetwork.id });

  const rpcOverride = (scaffoldConfig.rpcOverrides as Record<number, string> | undefined)?.[targetNetwork.id];
  const fallbackRpc = targetNetwork.rpcUrls.default.http[0];
  const rpcUrl = rpcOverride ?? fallbackRpc;

  const [state, setState] = useState<State>({ seed: null, count: 0 });

  // The count also lives in a ref so `allocateNext` can bump the stealth
  // index synchronously inside a tight async loop (e.g. splitting a borrow
  // into several buckets). Relying on `state.count` alone loses iterations
  // because the React state updater hasn't committed yet between awaits,
  // and all iterations would reuse the same index → the same stealth.
  const countRef = useRef(0);

  useEffect(() => {
    if (!mainAddress) {
      countRef.current = 0;
      setState({ seed: null, count: 0 });
      return;
    }
    const seed = loadStoredSeed(mainAddress);
    const count = loadStealthCount(mainAddress);
    countRef.current = count;
    setState({ seed, count });
  }, [mainAddress]);

  const unlock = useCallback(async () => {
    if (!mainAddress) throw new Error("Connect a wallet first");
    if (state.seed) return state.seed;
    const signature = await signMessageAsync({
      message: stealthSigningMessage(mainAddress),
      account: mainAddress,
    });
    const seed = seedFromSignature(signature);
    storeSeed(mainAddress, seed);
    setState(s => ({ ...s, seed }));
    return seed;
  }, [mainAddress, signMessageAsync, state.seed]);

  const lock = useCallback(() => {
    if (!mainAddress) return;
    clearStoredSeed(mainAddress);
    setState(s => ({ ...s, seed: null }));
  }, [mainAddress]);

  const stealthAccounts = useMemo<StealthAccount[]>(() => {
    if (!state.seed) return [];
    return deriveRange(state.seed, state.count);
  }, [state.seed, state.count]);

  const allocateNext = useCallback((): StealthAccount => {
    if (!state.seed || !mainAddress) {
      throw new Error("Stealth wallet is locked. Unlock it first.");
    }
    const nextIndex = countRef.current;
    const next = deriveStealthAccount(state.seed, nextIndex);
    const newCount = nextIndex + 1;
    countRef.current = newCount;
    storeStealthCount(mainAddress, newCount);
    setState(s => ({ ...s, count: newCount }));
    return next;
  }, [state.seed, mainAddress]);

  const peekNext = useCallback((): StealthAccount | null => {
    if (!state.seed) return null;
    return deriveStealthAccount(state.seed, countRef.current);
  }, [state.seed]);

  const getByIndex = useCallback(
    (index: number): StealthAccount | null => {
      if (!state.seed) return null;
      return deriveStealthAccount(state.seed, index);
    },
    [state.seed],
  );

  const getByAddress = useCallback(
    (address: Address): StealthAccount | null => {
      if (!state.seed) return null;
      const target = address.toLowerCase();
      for (let i = 0; i < state.count; i++) {
        const s = deriveStealthAccount(state.seed, i);
        if (s.address.toLowerCase() === target) return s;
      }
      return null;
    },
    [state.seed, state.count],
  );

  const getStealthWalletClient = useCallback(
    (stealth: StealthAccount): WalletClient => createStealthWalletClient(stealth, targetNetwork, rpcUrl),
    [targetNetwork, rpcUrl],
  );

  return {
    mainAddress,
    isUnlocked: state.seed !== null,
    isSigning,
    count: state.count,
    stealthAccounts,
    unlock,
    lock,
    allocateNext,
    peekNext,
    getByIndex,
    getByAddress,
    getStealthWalletClient,
    publicClient,
    rpcUrl,
    chain: targetNetwork,
    // expose http transport helper so consumers can mimic the same setup
    httpTransport: () => http(rpcUrl),
  };
};

export type UseStealthWalletReturn = ReturnType<typeof useStealthWallet>;
