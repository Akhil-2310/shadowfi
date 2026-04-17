"use client";

import { Address as AddressDisplay } from "@scaffold-ui/components";
import { LockClosedIcon, LockOpenIcon } from "@heroicons/react/24/outline";
import { useStealthWallet } from "~~/hooks/useStealthWallet";

type Props = {
  compact?: boolean;
  children?: React.ReactNode;
};

/**
 * Shared UI for unlocking/managing the deterministic stealth wallets.
 * Renders either a compact status chip or a full card depending on `compact`.
 */
export const StealthVault = ({ compact = false, children }: Props) => {
  const { mainAddress, isUnlocked, isSigning, count, stealthAccounts, unlock, lock } = useStealthWallet();

  if (!mainAddress) {
    return <div className="alert alert-info">Connect a wallet to derive your stealth vault.</div>;
  }

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        {isUnlocked ? (
          <>
            <div className="badge badge-success gap-1">
              <LockOpenIcon className="h-3 w-3" />
              Vault unlocked · {count} stealth
            </div>
            <button className="btn btn-xs btn-ghost" onClick={lock}>
              Lock
            </button>
          </>
        ) : (
          <button
            className="btn btn-xs btn-primary"
            onClick={() => unlock().catch(() => undefined)}
            disabled={isSigning}
          >
            <LockClosedIcon className="h-3 w-3" />
            {isSigning ? "Waiting for signature…" : "Unlock stealth vault"}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="card bg-base-100 shadow-xl">
      <div className="card-body">
        <h2 className="card-title">
          {isUnlocked ? (
            <LockOpenIcon className="h-5 w-5 text-success" />
          ) : (
            <LockClosedIcon className="h-5 w-5 text-warning" />
          )}
          Stealth vault
        </h2>
        <p className="text-sm opacity-70">
          Your stealth addresses are deterministically derived from a one-time signature over a fixed message with your
          primary wallet. The seed never leaves this browser tab, and addresses are not linked on-chain to your main
          identity — except through the Karma gate at request time.
        </p>

        <div className="text-sm">
          Primary identity: <AddressDisplay address={mainAddress} />
        </div>

        {isUnlocked ? (
          <>
            <div className="text-sm mt-2">
              <span className="font-semibold">{count}</span> stealth address{count === 1 ? "" : "es"} allocated.
            </div>
            {stealthAccounts.length > 0 && (
              <div className="mt-2 max-h-48 overflow-y-auto rounded-box bg-base-200 p-2 space-y-1">
                {stealthAccounts.map(s => (
                  <div key={s.address} className="text-xs flex items-center justify-between gap-2">
                    <span className="opacity-60 w-10 shrink-0">#{s.index}</span>
                    <AddressDisplay address={s.address} size="xs" />
                  </div>
                ))}
              </div>
            )}
            <div className="card-actions mt-2">
              <button className="btn btn-sm btn-ghost" onClick={lock}>
                Lock vault
              </button>
            </div>
          </>
        ) : (
          <div className="card-actions mt-2">
            <button className="btn btn-primary" onClick={() => unlock().catch(() => undefined)} disabled={isSigning}>
              {isSigning ? "Waiting for signature…" : "Unlock stealth vault"}
            </button>
          </div>
        )}

        {children}
      </div>
    </div>
  );
};
