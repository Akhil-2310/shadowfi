"use client";

import { useMemo, useState } from "react";
import { Address as AddressDisplay } from "@scaffold-ui/components";
import type { NextPage } from "next";
import { formatEther } from "viem";
import { useAccount, usePublicClient } from "wagmi";
import {
  ArrowPathIcon,
  ArrowTrendingUpIcon,
  ClockIcon,
  CurrencyDollarIcon,
  DocumentMagnifyingGlassIcon,
} from "@heroicons/react/24/outline";
import { FeeBadge } from "~~/components/FeeBadge";
import { useDeployedContractInfo, useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { useLineaContractGasQuote } from "~~/hooks/useLineaGasQuote";
import { formatBps, statusBadgeClass, statusLabel } from "~~/utils/lending";
import { lineaContractGasQuote, toFeeOverrides } from "~~/utils/lineaGas";
import { notification } from "~~/utils/scaffold-eth";

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

const MarketPage: NextPage = () => {
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [minRate, setMinRate] = useState<number>(0);

  const {
    data: loans,
    refetch,
    isRefetching,
  } = useScaffoldReadContract({
    contractName: "BucketLending",
    functionName: "getLoans",
    watch: true,
  });

  const allEntries = useMemo(() => ((loans as Loan[] | undefined) ?? []).map((loan, id) => ({ loan, id })), [loans]);

  const filtered = useMemo(() => {
    return allEntries.filter(({ loan }) => {
      if (onlyOpen && Number(loan.status) !== 0) return false;
      if (Number(loan.interestBps) < minRate) return false;
      return true;
    });
  }, [allEntries, onlyOpen, minRate]);

  // High-level market stats computed over ALL loans, not the filtered view, so
  // toggling filters never hides the underlying market size.
  const stats = useMemo(() => {
    const open = allEntries.filter(e => Number(e.loan.status) === 0);
    const totalRequested = open.reduce((acc, e) => acc + e.loan.bucketAmount, 0n);
    const totalFunded = open.reduce((acc, e) => acc + e.loan.fundedAmount, 0n);
    const avgBps = open.length ? open.reduce((acc, e) => acc + Number(e.loan.interestBps), 0) / open.length : 0;
    return {
      openCount: open.length,
      totalLoans: allEntries.length,
      totalRequested,
      totalFunded,
      avgBps,
    };
  }, [allEntries]);

  return (
    <div className="max-w-6xl mx-auto px-6 py-10 w-full">
      <div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-secondary/10 text-secondary">
            <ArrowTrendingUpIcon className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-3xl font-bold leading-tight">Loan market</h1>
            <p className="text-xs opacity-70">
              Every request is a single bucket. Fund fully or partially — the stealth borrower receives once it&apos;s
              full.
            </p>
          </div>
        </div>
        <button className="btn btn-sm btn-ghost" onClick={() => refetch()} disabled={isRefetching}>
          <ArrowPathIcon className={`h-4 w-4 ${isRefetching ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div className="stat bg-base-200 rounded-box py-3 px-4">
          <div className="stat-figure text-secondary opacity-70">
            <DocumentMagnifyingGlassIcon className="h-5 w-5" />
          </div>
          <div className="stat-title text-xs">Open requests</div>
          <div className="stat-value text-xl">{stats.openCount}</div>
          <div className="stat-desc text-xs">of {stats.totalLoans} total</div>
        </div>
        <div className="stat bg-base-200 rounded-box py-3 px-4">
          <div className="stat-figure text-primary opacity-70">
            <CurrencyDollarIcon className="h-5 w-5" />
          </div>
          <div className="stat-title text-xs">Requested</div>
          <div className="stat-value text-xl">{formatEther(stats.totalRequested)}</div>
          <div className="stat-desc text-xs">ETH across open loans</div>
        </div>
        <div className="stat bg-base-200 rounded-box py-3 px-4">
          <div className="stat-figure text-success opacity-70">
            <CurrencyDollarIcon className="h-5 w-5" />
          </div>
          <div className="stat-title text-xs">Funded so far</div>
          <div className="stat-value text-xl">{formatEther(stats.totalFunded)}</div>
          <div className="stat-desc text-xs">waiting for full buckets</div>
        </div>
        <div className="stat bg-base-200 rounded-box py-3 px-4">
          <div className="stat-figure text-accent opacity-70">
            <ClockIcon className="h-5 w-5" />
          </div>
          <div className="stat-title text-xs">Avg APR (open)</div>
          <div className="stat-value text-xl">{formatBps(Math.round(stats.avgBps))}</div>
          <div className="stat-desc text-xs">before Karma discount</div>
        </div>
      </div>

      <div className="card bg-base-200 mb-4">
        <div className="card-body py-4 flex-row flex-wrap gap-4 items-center">
          <label className="label cursor-pointer gap-2">
            <input
              type="checkbox"
              className="toggle toggle-primary"
              checked={onlyOpen}
              onChange={e => setOnlyOpen(e.target.checked)}
            />
            <span className="label-text">Only open</span>
          </label>
          <label className="form-control">
            <span className="label-text">Minimum APR</span>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={0}
                max={5000}
                step={50}
                value={minRate}
                onChange={e => setMinRate(Number(e.target.value))}
                className="range range-secondary w-40"
              />
              <span className="badge">{formatBps(minRate)}</span>
            </div>
          </label>
          <div className="ml-auto text-xs opacity-60">
            Showing <span className="font-semibold">{filtered.length}</span> of {stats.totalLoans}
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="card bg-base-100 border border-base-300 shadow-sm">
          <div className="card-body items-center text-center py-10">
            <DocumentMagnifyingGlassIcon className="h-10 w-10 opacity-40" />
            <p className="opacity-70 max-w-md">
              No loans match these filters yet. Try lowering the minimum APR, or open the first one from the Borrow
              page.
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(({ loan, id }) => (
            <LoanCard key={id} id={id} loan={loan} />
          ))}
        </div>
      )}
    </div>
  );
};

const LoanCard = ({ id, loan }: { id: number; loan: Loan }) => {
  const [amountEth, setAmountEth] = useState<string>("");
  const { writeContractAsync, isMining } = useScaffoldWriteContract({ contractName: "BucketLending" });
  const { data: lendingInfo } = useDeployedContractInfo({ contractName: "BucketLending" });
  const { address: lenderAddress } = useAccount();
  const publicClient = usePublicClient();

  const remaining = loan.bucketAmount - loan.fundedAmount;
  const pct = Number((loan.fundedAmount * 10000n) / (loan.bucketAmount || 1n)) / 100;

  // Live Karma-aware fee quote for funding `remaining` from the connected wallet.
  // Refreshes periodically — the guide warns that Karma quota state can change
  // between quote and send, so never cache.
  const { data: feeQuote, isLoading: feeLoading } = useLineaContractGasQuote({
    from: lenderAddress,
    address: lendingInfo?.address,
    abi: lendingInfo?.abi ?? [],
    functionName: "fundLoan",
    args: [BigInt(id)],
    value: remaining,
    enabled: Boolean(lenderAddress && lendingInfo && Number(loan.status) === 0 && remaining > 0n),
  });

  const fund = async (rawAmount: bigint) => {
    try {
      // Re-quote at send time for the exact amount the user is funding.
      let overrides: Partial<{ gas: bigint; maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }> = {};
      if (publicClient && lenderAddress && lendingInfo) {
        try {
          const quote = await lineaContractGasQuote(publicClient, {
            from: lenderAddress,
            address: lendingInfo.address,
            abi: lendingInfo.abi,
            functionName: "fundLoan",
            args: [BigInt(id)],
            value: rawAmount,
          });
          overrides = toFeeOverrides(quote);
        } catch {
          // Fallback to viem's chain-level estimate.
        }
      }
      await writeContractAsync({ functionName: "fundLoan", args: [BigInt(id)], value: rawAmount, ...overrides });
      notification.success("Funded!");
    } catch (e) {
      notification.error((e as Error).message);
    }
  };

  return (
    <div className="card bg-base-100 shadow-xl border border-base-300">
      <div className="card-body">
        <div className="flex items-center justify-between">
          <h3 className="card-title">#{id}</h3>
          <span className={`badge ${statusBadgeClass(loan.status)}`}>{statusLabel(loan.status)}</span>
        </div>
        <div className="text-xs opacity-70">
          Stealth borrower: <AddressDisplay address={loan.borrowerStealth} size="xs" />
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
            <div className="opacity-60">Duration</div>
            <div className="font-bold">{Number(loan.duration) / 86400} days</div>
          </div>
          <div>
            <div className="opacity-60">Funded</div>
            <div className="font-bold">{pct.toFixed(1)}%</div>
          </div>
        </div>

        {Number(loan.status) === 0 && (
          <>
            <progress className="progress progress-primary w-full mt-2" value={pct} max={100} />
            <div className="text-xs opacity-70 mt-1">Remaining: {formatEther(remaining)} ETH</div>
            {lenderAddress && (
              <div className="flex items-center gap-2 mt-2">
                <FeeBadge quote={feeQuote} isLoading={feeLoading} label="Fund" />
              </div>
            )}
            <div className="card-actions mt-3 items-end gap-2">
              <input
                type="text"
                inputMode="decimal"
                className="input input-bordered input-sm w-28"
                placeholder="ETH"
                value={amountEth}
                onChange={e => setAmountEth(e.target.value)}
              />
              <button
                className="btn btn-sm btn-primary"
                disabled={isMining}
                onClick={() => {
                  try {
                    const parsed = amountEth ? BigInt(Math.floor(Number(amountEth) * 1e18)) : remaining;
                    fund(parsed);
                  } catch {
                    notification.error("Invalid amount");
                  }
                }}
              >
                Fund
              </button>
              <button className="btn btn-sm btn-outline" disabled={isMining} onClick={() => fund(remaining)}>
                Fund all
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default MarketPage;
