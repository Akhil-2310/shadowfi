"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Address as AddressDisplay } from "@scaffold-ui/components";
import type { NextPage } from "next";
import { formatEther } from "viem";
import { useAccount } from "wagmi";
import { BeakerIcon, CpuChipIcon, LockClosedIcon, PauseIcon, PlayIcon } from "@heroicons/react/24/outline";
import { useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { formatBps, statusLabel } from "~~/utils/lending";
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

type AgentLog = {
  ts: number;
  loanId: number;
  amount: bigint;
  note: string;
  ok: boolean;
};

const DEFAULT_MIN_APR = 300; // 3%
const DEFAULT_MAX_PER_LOAN = "0.2"; // ETH
const DEFAULT_BUDGET = "1"; // ETH
const TICK_MS = 5000;

const AgentPage: NextPage = () => {
  const { address } = useAccount();

  const [enabled, setEnabled] = useState(false);
  const [minApr, setMinApr] = useState<number>(DEFAULT_MIN_APR);
  const [maxPerLoanEth, setMaxPerLoanEth] = useState<string>(DEFAULT_MAX_PER_LOAN);
  const [budgetEth, setBudgetEth] = useState<string>(DEFAULT_BUDGET);

  const [spent, setSpent] = useState<bigint>(0n);
  const [log, setLog] = useState<AgentLog[]>([]);
  const seen = useRef(new Set<number>());

  const { data: loans, refetch } = useScaffoldReadContract({
    contractName: "BucketLending",
    functionName: "getLoans",
    watch: true,
  });

  const { writeContractAsync } = useScaffoldWriteContract({ contractName: "BucketLending" });

  const budget = safeParseEth(budgetEth);
  const perLoanCap = safeParseEth(maxPerLoanEth);
  const remainingBudget = budget > spent ? budget - spent : 0n;

  const candidates = useMemo(() => {
    const list = ((loans as Loan[] | undefined) ?? []).map((loan, id) => ({ id, loan }));
    return list.filter(
      ({ loan }) =>
        Number(loan.status) === 0 && Number(loan.interestBps) >= minApr && loan.fundedAmount < loan.bucketAmount,
    );
  }, [loans, minApr]);

  useEffect(() => {
    if (!enabled || !address) return;
    let alive = true;

    const run = async () => {
      while (alive && enabled) {
        await refetch();
        if (!alive || !enabled) break;

        for (const { id, loan } of candidates) {
          if (!alive || !enabled) break;
          if (seen.current.has(id)) continue;

          const stillRemaining = loan.bucketAmount - loan.fundedAmount;
          const contribution = min(min(stillRemaining, perLoanCap), budget > spent ? budget - spent : 0n);
          if (contribution <= 0n) continue;

          seen.current.add(id);
          try {
            await writeContractAsync({
              functionName: "fundLoan",
              args: [BigInt(id)],
              value: contribution,
            });
            setSpent(s => s + contribution);
            pushLog(setLog, { ts: Date.now(), loanId: id, amount: contribution, note: "Funded", ok: true });
          } catch (e) {
            seen.current.delete(id);
            pushLog(setLog, {
              ts: Date.now(),
              loanId: id,
              amount: contribution,
              note: (e as Error).message.slice(0, 120),
              ok: false,
            });
          }
        }
        await sleep(TICK_MS);
      }
    };

    run();
    return () => {
      alive = false;
    };
  }, [enabled, address, candidates, refetch, writeContractAsync, perLoanCap, budget, spent]);

  useEffect(() => {
    if (!enabled) return;
    if (spent >= budget) {
      setEnabled(false);
      notification.success("Agent budget exhausted");
    }
  }, [spent, budget, enabled]);

  return (
    <div className="max-w-5xl mx-auto px-6 py-10 w-full">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10 text-primary">
            <CpuChipIcon className="h-6 w-6" />
          </div>
          <h1 className="text-3xl font-bold">Autonomous lender</h1>
        </div>
        <div className="badge badge-warning gap-2 font-semibold">
          <BeakerIcon className="h-3.5 w-3.5" />
          Coming soon
        </div>
      </div>

      <div className="card bg-gradient-to-br from-warning/10 via-base-200 to-base-100 border border-warning/40 shadow-md mb-6">
        <div className="card-body flex-row items-start gap-4 py-4">
          <div className="p-2 rounded-lg bg-warning/20 text-warning shrink-0">
            <LockClosedIcon className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <h2 className="font-semibold text-base">Preview only — auto-funding is disabled in this build</h2>
            <p className="text-sm opacity-80 mt-1">
              The heuristics, budget, candidate list and activity log below all work against live on-chain data so you
              can see exactly what the agent would do. Actual auto-funding is gated behind Status Network&apos;s
              RLN-bound session signing, which we&apos;re still finalizing. Ship date: soon.
            </p>
          </div>
        </div>
      </div>

      <p className="opacity-80 max-w-3xl mb-4">
        A client-side agent that watches the marketplace and auto-funds loans matching your heuristics. Everything runs
        locally under your wallet — you approve each on-chain action in your wallet, but strategy and cadence stay in
        your browser. Status Network&apos;s gasless execution and RLN-based rate limiting are what make this practical
        at scale.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 card bg-base-100 shadow-xl">
          <div className="card-body">
            <h2 className="card-title">Heuristics</h2>
            <label className="form-control">
              <span className="label-text">Minimum APR</span>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={50}
                  max={5000}
                  step={50}
                  value={minApr}
                  onChange={e => setMinApr(Number(e.target.value))}
                  className="range range-primary"
                />
                <span className="badge badge-primary">{formatBps(minApr)}</span>
              </div>
            </label>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
              <label className="form-control">
                <span className="label-text">Max per loan (ETH)</span>
                <input
                  type="text"
                  inputMode="decimal"
                  className="input input-bordered"
                  value={maxPerLoanEth}
                  onChange={e => setMaxPerLoanEth(e.target.value)}
                />
              </label>
              <label className="form-control">
                <span className="label-text">Total budget (ETH)</span>
                <input
                  type="text"
                  inputMode="decimal"
                  className="input input-bordered"
                  value={budgetEth}
                  onChange={e => setBudgetEth(e.target.value)}
                />
              </label>
            </div>

            <div className="card-actions mt-3 items-center gap-2 flex-wrap">
              <div className="tooltip" data-tip="Auto-funding ships with RLN session signing — stay tuned.">
                <button className="btn btn-primary" onClick={() => setEnabled(e => !e)} disabled aria-disabled>
                  {enabled ? (
                    <>
                      <PauseIcon className="h-4 w-4" />
                      Pause agent
                    </>
                  ) : (
                    <>
                      <PlayIcon className="h-4 w-4" />
                      Start agent
                    </>
                  )}
                </button>
              </div>
              <span className="badge badge-warning badge-outline">Coming soon</span>
              <button
                className="btn btn-ghost btn-sm ml-auto"
                onClick={() => {
                  setLog([]);
                  seen.current.clear();
                  setSpent(0n);
                }}
              >
                Reset preview
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="stat bg-base-200 rounded-box">
            <div className="stat-title">Agent</div>
            <div className="stat-value text-warning">PREVIEW</div>
            <div className="stat-desc">Auto-funding ships soon ({TICK_MS / 1000}s poll)</div>
          </div>
          <div className="stat bg-base-200 rounded-box">
            <div className="stat-title">Remaining budget</div>
            <div className="stat-value">{formatEther(remainingBudget)} ETH</div>
            <div className="stat-desc">Spent {formatEther(spent)} ETH (simulated)</div>
          </div>
          <div className="stat bg-base-200 rounded-box">
            <div className="stat-title">Open candidates</div>
            <div className="stat-value">{candidates.length}</div>
            <div className="stat-desc">matching {formatBps(minApr)}+ right now</div>
          </div>
        </div>
      </div>

      <div className="divider mt-8">Activity</div>

      {log.length === 0 ? (
        <div className="alert">No agent activity yet — the log will populate here once auto-funding goes live.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="table table-sm">
            <thead>
              <tr>
                <th>Time</th>
                <th>Loan</th>
                <th>Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {log.map((entry, i) => (
                <tr key={i}>
                  <td>{new Date(entry.ts).toLocaleTimeString()}</td>
                  <td>#{entry.loanId}</td>
                  <td>{formatEther(entry.amount)} ETH</td>
                  <td className={entry.ok ? "text-success" : "text-error"}>{entry.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="divider mt-8">
        Open candidates the agent <em>would</em> fund
      </div>

      {candidates.length === 0 ? (
        <div className="alert">No open loans currently match your filter.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {candidates.map(({ id, loan }) => (
            <div key={id} className="card bg-base-100 shadow">
              <div className="card-body py-3">
                <div className="flex items-center justify-between">
                  <strong>#{id}</strong>
                  <span className="badge">{statusLabel(loan.status)}</span>
                </div>
                <div className="text-xs opacity-60">
                  Stealth: <AddressDisplay address={loan.borrowerStealth} size="xs" />
                </div>
                <div className="text-sm">
                  {formatEther(loan.bucketAmount)} ETH @ {formatBps(loan.interestBps)}
                </div>
                <div className="text-xs opacity-60">
                  Filled {formatEther(loan.fundedAmount)} / {formatEther(loan.bucketAmount)} ETH
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const safeParseEth = (value: string): bigint => {
  try {
    if (!value) return 0n;
    const [whole, frac = ""] = value.split(".");
    const fracPadded = (frac + "0".repeat(18)).slice(0, 18);
    return BigInt(whole || "0") * 10n ** 18n + BigInt(fracPadded || "0");
  } catch {
    return 0n;
  }
};

const min = (a: bigint, b: bigint) => (a < b ? a : b);

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const pushLog = (setter: React.Dispatch<React.SetStateAction<AgentLog[]>>, entry: AgentLog) =>
  setter(prev => [entry, ...prev].slice(0, 30));

export default AgentPage;
