import { Abi, Address, PublicClient, WalletClient } from "viem";
import { LineaGasQuote } from "~~/utils/lineaGas";

/**
 * Design note: why we batch-fund instead of topping up per-loan.
 *
 * When a stealth isn't on Status's gasless tier (no Karma quota), it needs a
 * small ETH top-up before it can submit its permit. Doing that top-up as one
 * main -> stealth transfer per loan has two privacy problems:
 *
 *   1. Each stealth is trivially tied 1:1 to the Karma holder's main wallet,
 *      because only the Karma holder's tx touches that stealth first.
 *   2. The exact top-up amount telegraphs the tx cost, which on a non-gasless
 *      path is a tight function of the bucket size and the contract call.
 *
 * Routing every top-up through `StealthDisperser.batch(recipients, amounts)`
 * in a single tx mitigates both:
 *
 *   - From the chain's perspective the main wallet funds a *set* of stealths
 *     in one atomic action. Observers can link the set to the main wallet,
 *     but they can't tell from the funding tx which recipient will do what.
 *   - We use a single uniform amount for every recipient, so the individual
 *     top-up no longer carries size-specific info.
 *   - We mix in K decoy recipients (freshly allocated stealths with no loan
 *     attached) that dilute correlation: a watcher seeing N funded stealths
 *     can't tell which of them are actually borrowing.
 *
 * Limitations we're honest about:
 *   - An attacker can still compute "this main wallet has N stealths funded
 *     in the same batch" — the set-level link is visible. That is
 *     fundamentally what the non-gasless fallback costs us.
 *   - Decoys cost extra gas paid by the Karma holder. That's fine because
 *     the disperser tx itself is almost always gasless for a Karma holder.
 *
 * The fully-private path (every stealth is gasless) still avoids this entire
 * flow; batching only runs when Status returns non-zero fees for at least
 * one of the real stealths.
 */

/** Rounding tick used to fuzz per-recipient amounts. 0.0001 ETH is cheap dust
 *  on an L2 and keeps the uniform amount from exactly matching `required`. */
const AMOUNT_TICK = 10n ** 14n; // 0.0001 ETH

/** Ceil-divide `n` by `tick` (positive values only). */
const ceilToTick = (n: bigint, tick: bigint): bigint => {
  if (n === 0n) return 0n;
  const remainder = n % tick;
  return remainder === 0n ? n : n + (tick - remainder);
};

export type StealthPlanItem = {
  stealth: Address;
  /** `gas * maxFeePerGas + msg.value` required for this stealth's upcoming tx. */
  required: bigint;
  /** Pre-existing balance of the stealth at plan time. Usually 0. */
  balance: bigint;
  /** The original fee quote, so callers can reuse it as tx overrides. */
  quote: LineaGasQuote;
};

export type BatchFundingPlan = {
  items: StealthPlanItem[];
  decoyStealths: Address[];
  /** Uniform amount sent to every recipient (real + decoy) in the batch. */
  perRecipientAmount: bigint;
  /** Total ETH the main wallet must provide to the disperser. */
  totalValue: bigint;
  /** True when at least one real stealth needs funding right now. */
  needsFunding: boolean;
  /** True when every real stealth came back gasless. */
  allGasless: boolean;
};

export type BatchFundingResult = {
  plan: BatchFundingPlan;
  funded: boolean;
  txHash?: `0x${string}`;
};

/**
 * Build a funding plan from per-stealth gas quotes + optional `msg.value`
 * per item (e.g. repay's interest). Call this BEFORE the disperser tx.
 *
 * `decoyStealths` should be addresses the UI has also allocated but will
 * not use for this borrow cycle — freshly-derived stealth indices are a
 * natural source.
 */
export const buildBatchFundingPlan = ({
  items,
  decoyStealths,
  amountTick = AMOUNT_TICK,
}: {
  items: StealthPlanItem[];
  decoyStealths: Address[];
  amountTick?: bigint;
}): BatchFundingPlan => {
  const allGasless = items.every(i => i.quote.isGasless);
  // We only need to top up stealths whose balance doesn't already cover their
  // required amount. If none do, the plan is a no-op.
  const maxDeficit = items.reduce((acc, it) => {
    const deficit = it.required > it.balance ? it.required - it.balance : 0n;
    return deficit > acc ? deficit : acc;
  }, 0n);

  if (maxDeficit === 0n) {
    return {
      items,
      decoyStealths,
      perRecipientAmount: 0n,
      totalValue: 0n,
      needsFunding: false,
      allGasless,
    };
  }

  // Uniform amount, rounded UP to an 0.0001-ETH tick so every recipient gets
  // the exact same transfer regardless of which bucket they'll borrow. Pad by
  // one extra tick so a late re-quote with slightly higher fees still fits.
  const perRecipientAmount = ceilToTick(maxDeficit, amountTick) + amountTick;
  const totalRecipients = BigInt(items.length + decoyStealths.length);
  const totalValue = perRecipientAmount * totalRecipients;

  return {
    items,
    decoyStealths,
    perRecipientAmount,
    totalValue,
    needsFunding: true,
    allGasless,
  };
};

/**
 * Execute the plan against the on-chain disperser and wait for the receipt.
 *
 * The order of recipients in the calldata is intentionally shuffled so the
 * position of a real stealth inside the array doesn't betray its role; an
 * observer seeing only the calldata can't pick "the real ones" by index.
 */
export const batchFundStealths = async ({
  publicClient,
  mainWalletClient,
  disperser,
  plan,
}: {
  publicClient: PublicClient;
  mainWalletClient: WalletClient;
  disperser: { address: Address; abi: Abi };
  plan: BatchFundingPlan;
}): Promise<BatchFundingResult> => {
  if (!plan.needsFunding) {
    return { plan, funded: false };
  }

  const realRecipients = plan.items.map(i => i.stealth);
  const recipients = shuffleAddresses([...realRecipients, ...plan.decoyStealths]);
  const amounts = recipients.map(() => plan.perRecipientAmount);

  const mainAccount = mainWalletClient.account;
  if (!mainAccount) {
    throw new Error("Main wallet is not connected — cannot batch-fund stealths.");
  }
  const chain = mainWalletClient.chain;
  if (!chain) {
    throw new Error("Main wallet has no chain context — reconnect your wallet.");
  }

  const hash = await mainWalletClient.writeContract({
    account: mainAccount,
    chain,
    address: disperser.address,
    abi: disperser.abi,
    functionName: "batch",
    args: [recipients, amounts],
    value: plan.totalValue,
  });
  await publicClient.waitForTransactionReceipt({ hash });

  return { plan, funded: true, txHash: hash };
};

/** Fisher-Yates on a fresh copy; crypto-random so recipient order isn't a
 *  deterministic function of allocation order. */
const shuffleAddresses = (xs: Address[]): Address[] => {
  const out = xs.slice();
  const rand = new Uint32Array(1);
  for (let i = out.length - 1; i > 0; i--) {
    crypto.getRandomValues(rand);
    const j = rand[0] % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};
