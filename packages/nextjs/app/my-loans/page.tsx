"use client";

import { useMemo, useState } from "react";
import { Address as AddressDisplay } from "@scaffold-ui/components";
import type { NextPage } from "next";
import { formatEther } from "viem";
import { useAccount, usePublicClient, useReadContracts, useWalletClient } from "wagmi";
import { BanknotesIcon, EyeSlashIcon, UserCircleIcon } from "@heroicons/react/24/outline";
import { FeeBadge } from "~~/components/FeeBadge";
import { StealthVault } from "~~/components/StealthVault";
import { useDeployedContractInfo, useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { useLineaContractGasQuote } from "~~/hooks/useLineaGasQuote";
import { useStealthWallet } from "~~/hooks/useStealthWallet";
import { formatBps, statusBadgeClass, statusLabel } from "~~/utils/lending";
import { lineaContractGasQuote, toFeeOverrides } from "~~/utils/lineaGas";
import { notification } from "~~/utils/scaffold-eth";
import { ensureStealthGas } from "~~/utils/stealthFunding";

type Loan = {
  borrowerStealth: `0x${string}`;
  bucketAmount: bigint;
  interestBps: bigint;
  duration: bigint;
  fundedAmount: bigint;
  fundedAt: bigint;
  dueTime: bigint;
  createdAt: bigint;
  status: number;
};

type LoanEntry = { id: number; loan: Loan };

type Tab = "borrower" | "lender";

const MyLoansPage: NextPage = () => {
  const { address } = useAccount();
  const [tab, setTab] = useState<Tab>("borrower");

  const { data: loans, refetch } = useScaffoldReadContract({
    contractName: "BucketLending",
    functionName: "getLoans",
    watch: true,
  });

  const entries: LoanEntry[] = useMemo(
    () => ((loans as Loan[] | undefined) ?? []).map((loan, id) => ({ id, loan })),
    [loans],
  );

  return (
    <div className="max-w-6xl mx-auto px-6 py-10 w-full">
      <div className="flex items-center gap-3 mb-3">
        <div className="p-2 rounded-lg bg-accent/10 text-accent">
          <UserCircleIcon className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-3xl font-bold leading-tight">My loans</h1>
          <p className="text-xs opacity-70">
            Two views: loans <em>you</em> opened from your stealth vault, and loans you&apos;ve helped fund as a lender.
          </p>
        </div>
      </div>

      {!address && <div className="alert alert-warning mb-4">Connect a wallet to continue.</div>}

      <div role="tablist" className="tabs tabs-boxed w-fit mb-4">
        <button
          role="tab"
          className={`tab gap-2 ${tab === "borrower" ? "tab-active" : ""}`}
          onClick={() => setTab("borrower")}
        >
          <EyeSlashIcon className="h-4 w-4" />
          As borrower
        </button>
        <button
          role="tab"
          className={`tab gap-2 ${tab === "lender" ? "tab-active" : ""}`}
          onClick={() => setTab("lender")}
        >
          <BanknotesIcon className="h-4 w-4" />
          As lender
        </button>
      </div>

      {tab === "borrower" ? (
        <>
          <div className="mb-4">
            <StealthVault compact />
          </div>
          <BorrowerView entries={entries} refresh={refetch} />
        </>
      ) : (
        <LenderView entries={entries} />
      )}
    </div>
  );
};

const BorrowerView = ({ entries, refresh }: { entries: LoanEntry[]; refresh: () => void }) => {
  const { stealthAccounts, isUnlocked, unlock, getByAddress, getStealthWalletClient } = useStealthWallet();
  const { data: lendingInfo } = useDeployedContractInfo({ contractName: "BucketLending" });
  const publicClient = usePublicClient();
  const { data: mainWalletClient } = useWalletClient();
  const [busy, setBusy] = useState<number | null>(null);

  const stealthSet = useMemo(() => new Set(stealthAccounts.map(s => s.address.toLowerCase())), [stealthAccounts]);

  const mine = useMemo(
    () => entries.filter(e => stealthSet.has(e.loan.borrowerStealth.toLowerCase())),
    [entries, stealthSet],
  );

  if (!isUnlocked) {
    return (
      <div className="card bg-base-200">
        <div className="card-body">
          <p className="opacity-80">
            Your loans are tied to stealth addresses. Unlock your vault to see them and repay from the right account.
          </p>
          <div className="card-actions">
            <button className="btn btn-primary" onClick={() => unlock().catch(() => undefined)}>
              Unlock stealth vault
            </button>
          </div>
        </div>
      </div>
    );
  }

  const repay = async (entry: LoanEntry) => {
    if (!lendingInfo) return;
    const stealth = getByAddress(entry.loan.borrowerStealth);
    if (!stealth) {
      notification.error("Stealth key not found — allocate more indices?");
      return;
    }
    const owed = entry.loan.bucketAmount + (entry.loan.bucketAmount * entry.loan.interestBps) / 10_000n;

    const client = getStealthWalletClient(stealth);
    setBusy(entry.id);
    try {
      // Re-quote fees against the actual stealth sender right before we fire —
      // the stealth's Karma quota state is what decides gasless vs premium here.
      let overrides: Partial<{ gas: bigint; maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }> = {};
      if (publicClient) {
        try {
          const quote = await lineaContractGasQuote(publicClient, {
            from: stealth.address,
            address: lendingInfo.address,
            abi: lendingInfo.abi,
            functionName: "repayLoan",
            args: [BigInt(entry.id)],
            value: owed,
          });
          overrides = toFeeOverrides(quote);

          // The stealth already holds the bucket principal it received when the
          // loan funded, but it still needs the interest portion + (if not
          // gasless) gas. Top up the exact deficit from the main wallet so
          // `msg.value = owed` plus fees can be covered.
          if (mainWalletClient) {
            const result = await ensureStealthGas({
              publicClient,
              mainWalletClient,
              stealth: stealth.address,
              quote,
              extraValue: owed,
            });
            if (result.funded) {
              notification.info(
                `Topped up ${formatEther(result.topUp)} ETH from your main wallet to cover interest${
                  quote.isGasless ? "" : " + gas"
                }.`,
              );
            }
          }
        } catch {
          // Fallback to viem's chain-level estimate.
        }
      }
      const hash = await client.writeContract({
        account: stealth.account,
        chain: client.chain,
        address: lendingInfo.address,
        abi: lendingInfo.abi,
        functionName: "repayLoan",
        args: [BigInt(entry.id)],
        value: owed,
        ...overrides,
      });
      notification.success(`Repay tx submitted: ${hash.slice(0, 10)}…`);
      refresh();
    } catch (e) {
      notification.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const openCount = mine.filter(e => Number(e.loan.status) === 0).length;
  const fundedCount = mine.filter(e => Number(e.loan.status) === 1).length;
  const totalPrincipal = mine.reduce((acc, e) => acc + e.loan.bucketAmount, 0n);
  const totalOwed = mine
    .filter(e => Number(e.loan.status) === 1)
    .reduce((acc, e) => acc + e.loan.bucketAmount + (e.loan.bucketAmount * e.loan.interestBps) / 10_000n, 0n);

  if (mine.length === 0) {
    return (
      <div className="card bg-base-100 border border-base-300 shadow-sm">
        <div className="card-body items-center text-center py-10">
          <EyeSlashIcon className="h-10 w-10 opacity-40" />
          <p className="opacity-70 max-w-md">
            No loans yet across your {stealthAccounts.length} stealth address
            {stealthAccounts.length === 1 ? "" : "es"}. Open one from the Borrow page — your main wallet stays off-chain
            the whole time.
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div className="stat bg-base-200 rounded-box py-3 px-4">
          <div className="stat-title text-xs">My loans</div>
          <div className="stat-value text-xl">{mine.length}</div>
          <div className="stat-desc text-xs">across {stealthAccounts.length} stealths</div>
        </div>
        <div className="stat bg-base-200 rounded-box py-3 px-4">
          <div className="stat-title text-xs">Open</div>
          <div className="stat-value text-xl text-primary">{openCount}</div>
          <div className="stat-desc text-xs">waiting for lenders</div>
        </div>
        <div className="stat bg-base-200 rounded-box py-3 px-4">
          <div className="stat-title text-xs">Active</div>
          <div className="stat-value text-xl text-success">{fundedCount}</div>
          <div className="stat-desc text-xs">to repay</div>
        </div>
        <div className="stat bg-base-200 rounded-box py-3 px-4">
          <div className="stat-title text-xs">Outstanding owed</div>
          <div className="stat-value text-xl">{formatEther(totalOwed)}</div>
          <div className="stat-desc text-xs">ETH principal + interest</div>
        </div>
      </div>

      <div className="text-xs opacity-60 mb-3">
        Total lifetime principal across your loans: <span className="font-semibold">{formatEther(totalPrincipal)}</span>{" "}
        ETH.
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {mine.map(entry => (
          <MyLoanCard
            key={entry.id}
            entry={entry}
            actionLabel={busy === entry.id ? "Repaying…" : "Repay from stealth"}
            onAction={() => repay(entry)}
            disabled={Number(entry.loan.status) !== 1 || busy !== null}
            showLenders
            repayFrom={entry.loan.borrowerStealth}
          />
        ))}
      </div>
    </>
  );
};

const LenderView = ({ entries }: { entries: LoanEntry[] }) => {
  const { address } = useAccount();
  const { data: lendingInfo } = useDeployedContractInfo({ contractName: "BucketLending" });

  // Public RPCs on Hoodi choke on `eth_getLogs` from block 0, so instead of
  // scanning `LoanFunded` event history we multicall the view function
  // `getLenders(loanId)` across every loan and pick out the ones that include
  // the connected address. Faster, gasless, and correct immediately after a
  // fund tx lands.
  const contracts = useMemo(() => {
    if (!lendingInfo) return [];
    return entries.map(e => ({
      address: lendingInfo.address,
      abi: lendingInfo.abi,
      functionName: "getLenders" as const,
      args: [BigInt(e.id)] as const,
    }));
  }, [entries, lendingInfo]);

  const { data: lendersResults } = useReadContracts({
    contracts,
    query: { enabled: contracts.length > 0, refetchInterval: 5_000 },
  });

  const myFundedIds = useMemo(() => {
    if (!address || !lendersResults) return new Set<number>();
    const lower = address.toLowerCase();
    const out = new Set<number>();
    lendersResults.forEach((res, idx) => {
      if (res.status !== "success") return;
      const [lenders] = res.result as [readonly `0x${string}`[], readonly bigint[]];
      if (lenders.some(l => l.toLowerCase() === lower)) out.add(entries[idx].id);
    });
    return out;
  }, [address, lendersResults, entries]);

  const mine = useMemo(() => entries.filter(e => myFundedIds.has(e.id)), [entries, myFundedIds]);

  // Sum the connected lender's own contribution across every loan they've
  // touched. We pull it from the per-loan getLenders result so we don't need
  // event history, which is slow/flaky on public Hoodi RPCs.
  const { myContribution, activeCount, repaidCount } = useMemo(() => {
    if (!address || !lendersResults) return { myContribution: 0n, activeCount: 0, repaidCount: 0 };
    const lower = address.toLowerCase();
    let contribution = 0n;
    let active = 0;
    let repaid = 0;
    lendersResults.forEach((res, idx) => {
      if (res.status !== "success") return;
      const entry = entries[idx];
      if (!entry || !myFundedIds.has(entry.id)) return;
      const [lenders, shares] = res.result as [readonly `0x${string}`[], readonly bigint[]];
      lenders.forEach((l, i) => {
        if (l.toLowerCase() === lower) contribution += shares[i];
      });
      if (Number(entry.loan.status) === 1) active += 1;
      if (Number(entry.loan.status) === 2) repaid += 1;
    });
    return { myContribution: contribution, activeCount: active, repaidCount: repaid };
  }, [address, lendersResults, entries, myFundedIds]);

  if (!address) return null;
  if (mine.length === 0) {
    return (
      <div className="card bg-base-100 border border-base-300 shadow-sm">
        <div className="card-body items-center text-center py-10">
          <BanknotesIcon className="h-10 w-10 opacity-40" />
          <p className="opacity-70 max-w-md">
            You haven&apos;t funded any loans yet. Head to the market and fund a bucket — you&apos;ll be repaid pro-rata
            when the stealth borrower settles.
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div className="stat bg-base-200 rounded-box py-3 px-4">
          <div className="stat-title text-xs">Loans funded</div>
          <div className="stat-value text-xl">{mine.length}</div>
          <div className="stat-desc text-xs">you hold shares in</div>
        </div>
        <div className="stat bg-base-200 rounded-box py-3 px-4">
          <div className="stat-title text-xs">My capital out</div>
          <div className="stat-value text-xl text-primary">{formatEther(myContribution)}</div>
          <div className="stat-desc text-xs">ETH across your loans</div>
        </div>
        <div className="stat bg-base-200 rounded-box py-3 px-4">
          <div className="stat-title text-xs">Active</div>
          <div className="stat-value text-xl text-success">{activeCount}</div>
          <div className="stat-desc text-xs">awaiting repayment</div>
        </div>
        <div className="stat bg-base-200 rounded-box py-3 px-4">
          <div className="stat-title text-xs">Repaid</div>
          <div className="stat-value text-xl">{repaidCount}</div>
          <div className="stat-desc text-xs">settled cleanly</div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {mine.map(entry => (
          <MyLoanCard key={entry.id} entry={entry} showLenders />
        ))}
      </div>
    </>
  );
};

const MyLoanCard = ({
  entry,
  actionLabel,
  onAction,
  disabled,
  showLenders,
  repayFrom,
}: {
  entry: LoanEntry;
  actionLabel?: string;
  onAction?: () => void;
  disabled?: boolean;
  showLenders?: boolean;
  /** Stealth sender for the repay fee quote. Omitted for lender-view cards. */
  repayFrom?: `0x${string}`;
}) => {
  const { loan, id } = entry;
  const owed = loan.bucketAmount + (loan.bucketAmount * loan.interestBps) / 10_000n;
  const pct = Number((loan.fundedAmount * 10000n) / (loan.bucketAmount || 1n)) / 100;

  const { data: lendingInfo } = useDeployedContractInfo({ contractName: "BucketLending" });
  const { address: connected } = useAccount();
  const publicClient = usePublicClient();

  const { data: lendersData } = useScaffoldReadContract({
    contractName: "BucketLending",
    functionName: "getLenders",
    args: [BigInt(id)],
  });

  const { writeContractAsync, isMining } = useScaffoldWriteContract({ contractName: "BucketLending" });

  // Live repay-from-stealth gas quote (borrower view only).
  const { data: repayQuote, isLoading: repayQuoteLoading } = useLineaContractGasQuote({
    from: repayFrom,
    address: lendingInfo?.address,
    abi: lendingInfo?.abi ?? [],
    functionName: "repayLoan",
    args: [BigInt(id)],
    value: owed,
    enabled: Boolean(repayFrom && lendingInfo && Number(loan.status) === 1),
  });

  const markDefault = async () => {
    try {
      // Re-quote from the connected wallet — lender-driven call, not stealth.
      let overrides: Partial<{ gas: bigint; maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }> = {};
      if (publicClient && connected && lendingInfo) {
        try {
          const quote = await lineaContractGasQuote(publicClient, {
            from: connected,
            address: lendingInfo.address,
            abi: lendingInfo.abi,
            functionName: "markDefault",
            args: [BigInt(id)],
          });
          overrides = toFeeOverrides(quote);
        } catch {
          // Fallback to viem's chain-level estimate.
        }
      }
      await writeContractAsync({ functionName: "markDefault", args: [BigInt(id)], ...overrides });
      notification.success("Marked as defaulted");
    } catch (e) {
      notification.error((e as Error).message);
    }
  };

  const isOverdue =
    Number(loan.status) === 1 && Number(loan.dueTime) > 0 && BigInt(Math.floor(Date.now() / 1000)) > loan.dueTime;

  return (
    <div className="card bg-base-100 shadow-xl border border-base-300">
      <div className="card-body">
        <div className="flex items-center justify-between">
          <h3 className="card-title">#{id}</h3>
          <span className={`badge ${statusBadgeClass(loan.status)}`}>{statusLabel(loan.status)}</span>
        </div>
        <div className="text-xs opacity-70">
          Stealth: <AddressDisplay address={loan.borrowerStealth} size="xs" />
        </div>

        <div className="grid grid-cols-2 gap-2 mt-2 text-sm">
          <div>
            <div className="opacity-60">Bucket</div>
            <div className="font-bold">{formatEther(loan.bucketAmount)} ETH</div>
          </div>
          <div>
            <div className="opacity-60">APR</div>
            <div className="font-bold">{formatBps(loan.interestBps)}</div>
          </div>
          <div>
            <div className="opacity-60">Owed on repay</div>
            <div className="font-bold">{formatEther(owed)} ETH</div>
          </div>
          <div>
            <div className="opacity-60">Funded</div>
            <div className="font-bold">{pct.toFixed(1)}%</div>
          </div>
          {Number(loan.dueTime) > 0 && (
            <div className="col-span-2">
              <div className="opacity-60">Due</div>
              <div className="font-bold">{new Date(Number(loan.dueTime) * 1000).toLocaleString()}</div>
            </div>
          )}
        </div>

        {showLenders && lendersData && (lendersData as [`0x${string}`[], bigint[]])[0]?.length > 0 && (
          <div className="mt-2">
            <div className="text-xs opacity-60">Funded by</div>
            <div className="space-y-1 mt-1 max-h-28 overflow-y-auto">
              {(lendersData as [`0x${string}`[], bigint[]])[0].map((l, i) => (
                <div key={l} className="flex items-center justify-between text-xs gap-2">
                  <AddressDisplay address={l} size="xs" />
                  <span>{formatEther((lendersData as [`0x${string}`[], bigint[]])[1][i])} ETH</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {actionLabel && onAction && (
          <div className="card-actions mt-3 items-center gap-2">
            <button className="btn btn-sm btn-primary" onClick={onAction} disabled={disabled}>
              {actionLabel}
            </button>
            {repayFrom && <FeeBadge quote={repayQuote} isLoading={repayQuoteLoading} label="Repay" />}
          </div>
        )}

        {isOverdue && (
          <div className="card-actions mt-2">
            <button className="btn btn-xs btn-error" onClick={markDefault} disabled={isMining}>
              Flag default
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default MyLoansPage;
