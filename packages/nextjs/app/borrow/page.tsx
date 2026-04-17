"use client";

import { useMemo, useState } from "react";
import { Address as AddressDisplay } from "@scaffold-ui/components";
import type { NextPage } from "next";
import { Hex, formatEther, keccak256, parseEther, toBytes, toHex } from "viem";
import { useAccount, useChainId, usePublicClient, useSignTypedData, useWalletClient } from "wagmi";
import { BanknotesIcon } from "@heroicons/react/24/outline";
import { FeeBadge } from "~~/components/FeeBadge";
import { StealthVault } from "~~/components/StealthVault";
import { useDeployedContractInfo, useScaffoldReadContract } from "~~/hooks/scaffold-eth";
import { useLineaGasQuote } from "~~/hooks/useLineaGasQuote";
import { useStealthWallet } from "~~/hooks/useStealthWallet";
import { formatBps, splitIntoBuckets } from "~~/utils/lending";
import { lineaContractGasQuote, lineaGasQuote, toFeeOverrides } from "~~/utils/lineaGas";
import { notification } from "~~/utils/scaffold-eth";
import { StealthPlanItem, batchFundStealths, buildBatchFundingPlan } from "~~/utils/stealthBatchFunding";

const DEFAULT_AMOUNT = "1.5";
const DEFAULT_RATE_BPS = 800;
const DEFAULT_DURATION_DAYS = 14;
const KARMA_DECIMALS = 18n;

/** Conservative gas ceiling for `requestLoanWithPermit`. Used only to size
 *  the disperser top-up; the real gas is re-estimated per-submit. The actual
 *  call is ~150k; we pad so a single uniform per-recipient amount covers any
 *  bucket even with a priority-fee bump. */
const PERMIT_GAS_CEILING = 300_000n;

/** Number of decoy recipients we mix into the fan-out. Each decoy is a freshly
 *  derived stealth index that is consumed but never used for a loan in this
 *  cycle, so an observer can't tell from the disperser calldata alone which of
 *  the N funded stealths will actually borrow. */
const DECOY_COUNT = 2;

const formatKarma = (raw?: bigint) => {
  if (raw === undefined) return "—";
  const whole = raw / 10n ** KARMA_DECIMALS;
  const frac = raw % 10n ** KARMA_DECIMALS;
  if (frac === 0n) return whole.toString();
  const fracStr = (frac + 10n ** KARMA_DECIMALS).toString().slice(1, 5).replace(/0+$/, "");
  return fracStr ? `${whole}.${fracStr}` : whole.toString();
};

const randomSalt = (): Hex => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
};

const BorrowPage: NextPage = () => {
  const { address: mainAddress } = useAccount();
  const { isUnlocked, allocateNext, peekNext, unlock, isSigning, getStealthWalletClient, chain } = useStealthWallet();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { data: mainWalletClient } = useWalletClient();

  const { data: lendingInfo } = useDeployedContractInfo({ contractName: "BucketLending" });
  const { data: disperserInfo } = useDeployedContractInfo({ contractName: "StealthDisperser" });

  const { data: buckets } = useScaffoldReadContract({
    contractName: "BucketLending",
    functionName: "bucketsList",
  });

  const { data: karma } = useScaffoldReadContract({
    contractName: "Karma",
    functionName: "balanceOf",
    args: [mainAddress],
  });

  const { data: maxBorrow } = useScaffoldReadContract({
    contractName: "BucketLending",
    functionName: "getMaxBorrow",
    args: [karma ?? 0n],
  });

  const { data: previewBps } = useScaffoldReadContract({
    contractName: "BucketLending",
    functionName: "getAdjustedInterestBps",
    args: [BigInt(DEFAULT_RATE_BPS), karma ?? 0n],
  });

  const { signTypedDataAsync } = useSignTypedData();

  const [amountEth, setAmountEth] = useState<string>(DEFAULT_AMOUNT);
  const [rateBps, setRateBps] = useState<number>(DEFAULT_RATE_BPS);
  const [durationDays, setDurationDays] = useState<number>(DEFAULT_DURATION_DAYS);
  const [submitting, setSubmitting] = useState(false);

  // Preview the fee state of the next stealth address the borrower will use.
  // A self-send quote is enough to reveal whether the sender is in the gasless
  // tier (base + priority = 0) or carrying a premium — we don't need the real
  // permit signature for that, just the correct `from`.
  const previewStealth = useMemo(() => (isUnlocked ? peekNext() : null), [isUnlocked, peekNext]);
  const {
    data: feeQuote,
    isLoading: feeLoading,
    error: feeError,
  } = useLineaGasQuote({
    from: previewStealth?.address,
    to: previewStealth?.address,
    value: 0n,
    enabled: Boolean(previewStealth),
  });

  const split = useMemo(() => {
    if (!buckets) return null;
    try {
      const wanted = parseEther(amountEth || "0");
      return splitIntoBuckets(wanted, buckets as readonly bigint[]);
    } catch {
      return null;
    }
  }, [amountEth, buckets]);

  const totalWanted = (() => {
    try {
      return parseEther(amountEth || "0");
    } catch {
      return 0n;
    }
  })();

  const exceedsCap = maxBorrow !== undefined && split !== null && split.some(b => b > maxBorrow);

  const submit = async () => {
    if (!mainAddress || !lendingInfo) {
      notification.error("Connect a wallet first");
      return;
    }
    if (!split || split.length === 0) {
      notification.error("Pick an amount expressible in allowed buckets");
      return;
    }
    if (exceedsCap) {
      notification.error("At least one bucket exceeds your Karma-based borrow cap");
      return;
    }
    if (!isUnlocked) {
      try {
        await unlock();
      } catch {
        return;
      }
    }

    const duration = BigInt(durationDays) * 86400n;
    const base = BigInt(rateBps);

    setSubmitting(true);
    try {
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 30); // 30 min window
      const domain = {
        name: "BucketLending",
        version: "1",
        chainId: BigInt(chainId),
        verifyingContract: lendingInfo.address,
      } as const;
      const types = {
        BorrowPermit: [
          { name: "lending", type: "address" },
          { name: "stealth", type: "address" },
          { name: "bucketAmount", type: "uint256" },
          { name: "baseInterestBps", type: "uint256" },
          { name: "duration", type: "uint256" },
          { name: "deadline", type: "uint256" },
          { name: "salt", type: "bytes32" },
        ],
      } as const;

      // Step 1: allocate every stealth we're going to use BEFORE any on-chain
      // work. We allocate both the real borrowers and K decoys up front so
      // the batch-fund (if we need it) sees the full recipient set at once.
      const realStealths = split.map(() => allocateNext());
      const decoyStealths = Array.from({ length: DECOY_COUNT }, () => allocateNext());

      // Step 2: figure out if any stealth needs a top-up. We use a self-send
      // quote to read each stealth's Karma tier — the gas of that call is
      // ~21k and what we actually care about is `isGasless` and
      // `maxFeePerGas`, not the exact gas of the upcoming permit call. If
      // any stealth comes back non-gasless we batch-fund through the
      // disperser with a single uniform amount per recipient.
      let needsFunding = false;
      if (publicClient) {
        const items: StealthPlanItem[] = await Promise.all(
          realStealths.map(async s => {
            const quote = await lineaGasQuote(publicClient, { from: s.address, to: s.address, value: 0n });
            const required = quote.isGasless ? 0n : PERMIT_GAS_CEILING * quote.maxFeePerGas;
            const balance = await publicClient.getBalance({ address: s.address });
            return { stealth: s.address, required, balance, quote };
          }),
        );

        const plan = buildBatchFundingPlan({
          items,
          decoyStealths: decoyStealths.map(d => d.address),
        });

        if (plan.needsFunding) {
          needsFunding = true;
          if (!mainWalletClient || !disperserInfo) {
            notification.error("Main wallet or disperser not ready — cannot fan out top-ups.");
            return;
          }
          const toast = notification.loading(
            `Fanning out gas top-ups to ${plan.items.length + plan.decoyStealths.length} stealths in one tx…`,
          );
          try {
            await batchFundStealths({
              publicClient,
              mainWalletClient,
              disperser: disperserInfo,
              plan,
            });
            notification.remove(toast);
            notification.success(
              `Batched top-up sent (${formatEther(plan.perRecipientAmount)} ETH per stealth, ${plan.decoyStealths.length} decoys mixed in).`,
            );
          } catch (err) {
            notification.remove(toast);
            throw err;
          }
        }
      }

      // Step 3: sign + submit each bucket from its stealth. The stealth now
      // has enough ETH either natively (gasless path) or from the batched
      // top-up, so the sequencer won't reject on insufficient balance.
      for (let i = 0; i < split.length; i++) {
        const bucket = split[i];
        const stealth = realStealths[i];
        // Fresh salt per permit; using keccak over a random 32-byte seed
        // ensures no correlation across loans from the same signer.
        const salt = keccak256(toBytes(randomSalt()));

        const signature = await signTypedDataAsync({
          domain,
          types,
          primaryType: "BorrowPermit",
          message: {
            lending: lendingInfo.address,
            stealth: stealth.address,
            bucketAmount: bucket,
            baseInterestBps: base,
            duration,
            deadline,
            salt,
          },
        });

        const stealthClient = getStealthWalletClient(stealth);
        const writeArgs = [stealth.address, bucket, base, duration, deadline, salt, signature] as const;

        // Re-quote at send time (per Status guide: sender Karma state can
        // change between quote and submit). Pass gas + fee fields explicitly
        // so viem doesn't fall back to eth_estimateGas / eth_gasPrice and
        // miss the Karma-aware pricing.
        let overrides: Partial<{ gas: bigint; maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }> = {};
        if (publicClient) {
          try {
            const quote = await lineaContractGasQuote(publicClient, {
              from: stealth.address,
              address: lendingInfo.address,
              abi: lendingInfo.abi,
              functionName: "requestLoanWithPermit",
              args: writeArgs,
            });
            overrides = toFeeOverrides(quote);
          } catch {
            // If linea_estimateGas blips, let viem's chain-level fallback run.
          }
        }

        await stealthClient.writeContract({
          account: stealth.account,
          chain: chain,
          address: lendingInfo.address,
          abi: lendingInfo.abi,
          functionName: "requestLoanWithPermit",
          args: writeArgs,
          ...overrides,
        });
      }
      if (needsFunding) {
        notification.warning(
          "Non-gasless fallback active: your main wallet funded this batch of stealths. The set is linkable to your identity, but per-stealth bucket sizes and intra-set order are not.",
        );
      }
      notification.success(`Opened ${split.length} loan request${split.length === 1 ? "" : "s"}`);
    } catch (e) {
      notification.error((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-6 py-10 w-full">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 rounded-lg bg-primary/10 text-primary">
          <BanknotesIcon className="h-6 w-6" />
        </div>
        <h1 className="text-3xl font-bold">Request a loan</h1>
      </div>

      {!mainAddress && <div className="alert alert-warning mb-4">Connect a wallet to continue.</div>}

      <div className="alert alert-info mb-6 text-sm">
        Your main wallet signs an off-chain borrow permit. The on-chain request is sent from a stealth address you
        control. Nothing on-chain links the two — the Karma holder&apos;s address lives only in the ephemeral signature.
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="card bg-base-100 shadow-xl">
            <div className="card-body">
              <h2 className="card-title">Loan parameters</h2>

              <label className="form-control">
                <span className="label-text">Total amount (ETH)</span>
                <input
                  type="text"
                  inputMode="decimal"
                  className="input input-bordered"
                  value={amountEth}
                  onChange={e => setAmountEth(e.target.value)}
                />
              </label>

              <label className="form-control mt-2">
                <span className="label-text">Base interest rate</span>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={50}
                    max={5000}
                    step={50}
                    value={rateBps}
                    onChange={e => setRateBps(Number(e.target.value))}
                    className="range range-primary"
                  />
                  <span className="badge badge-primary">{formatBps(rateBps)}</span>
                </div>
              </label>

              <label className="form-control mt-2">
                <span className="label-text">Duration (days)</span>
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={durationDays}
                  onChange={e => setDurationDays(Number(e.target.value))}
                  className="input input-bordered w-40"
                />
              </label>
            </div>
          </div>

          <div className="card bg-base-100 shadow-xl">
            <div className="card-body">
              <h2 className="card-title">Preview</h2>
              {!buckets && <p className="opacity-70">Loading buckets…</p>}
              {buckets && (
                <div className="text-sm opacity-70">
                  Allowed buckets: {(buckets as readonly bigint[]).map(b => `${formatEther(b)} ETH`).join(" · ")}
                </div>
              )}

              <div className="text-sm">
                Target: <strong>{amountEth || "0"} ETH</strong>
              </div>

              {split === null ? (
                <div className="alert alert-error mt-2">
                  This amount cannot be expressed exactly with the current buckets. Try a value that&apos;s a sum of{" "}
                  {(buckets as readonly bigint[] | undefined)?.map(b => `${formatEther(b)}`).join(" / ")} ETH.
                </div>
              ) : (
                <>
                  <div className="text-sm mt-2">
                    Will open <strong>{split.length}</strong> independent loan{split.length === 1 ? "" : "s"} against{" "}
                    <strong>{split.length}</strong> different stealth address{split.length === 1 ? "" : "es"}, each with
                    its own permit signature:
                  </div>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {split.map((b, i) => (
                      <span key={i} className="badge badge-outline">
                        {formatEther(b)} ETH
                      </span>
                    ))}
                  </div>
                </>
              )}

              {exceedsCap && (
                <div className="alert alert-warning mt-3">
                  Your Karma only supports up to {maxBorrow ? `${formatEther(maxBorrow)} ETH` : "0"} per bucket. Earn
                  more Karma or reduce the amount.
                </div>
              )}

              {totalWanted > 0n && karma !== undefined && karma >= 10n ** 18n && previewBps !== undefined && (
                <div className="text-sm mt-2">
                  Expected per-loan interest after Karma discount: <strong>{formatBps(previewBps as bigint)}</strong>.
                </div>
              )}

              {previewStealth && (
                <div className="mt-3 text-xs space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="opacity-70">Gas for next stealth tx:</span>
                    <FeeBadge quote={feeQuote} isLoading={feeLoading} error={feeError} />
                  </div>
                  {feeQuote && !feeQuote.isGasless && (
                    <div className="opacity-70">
                      Not gasless on Status right now — your main wallet will fan out a single uniform top-up to all{" "}
                      {split?.length ?? 0} stealths <strong>plus {DECOY_COUNT} decoys</strong> in one batched tx via the
                      disperser. Observers can link the set to your identity, but not which stealth does what, and
                      per-recipient amounts are identical so they don&apos;t leak bucket sizes.
                    </div>
                  )}
                </div>
              )}

              <div className="card-actions mt-3">
                <button
                  className="btn btn-primary"
                  onClick={submit}
                  disabled={
                    !mainAddress ||
                    !lendingInfo ||
                    split === null ||
                    split.length === 0 ||
                    exceedsCap ||
                    submitting ||
                    isSigning
                  }
                >
                  {submitting
                    ? "Signing & submitting…"
                    : isSigning
                      ? "Unlock vault first…"
                      : `Open ${split?.length ?? 0} request${(split?.length ?? 0) === 1 ? "" : "s"}`}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="card bg-base-200">
            <div className="card-body">
              <h2 className="card-title">Your credit</h2>
              <div className="text-sm">
                Identity:{" "}
                {mainAddress ? (
                  <AddressDisplay address={mainAddress} size="xs" />
                ) : (
                  <span className="opacity-60">—</span>
                )}
              </div>
              <div className="text-sm">
                Karma: <strong>{formatKarma(karma as bigint | undefined)}</strong>
              </div>
              <div className="text-sm">
                Borrow cap per bucket:{" "}
                <strong>{maxBorrow !== undefined ? `${formatEther(maxBorrow)} ETH` : "—"}</strong>
              </div>
            </div>
          </div>

          <StealthVault />
        </div>
      </div>
    </div>
  );
};

export default BorrowPage;
