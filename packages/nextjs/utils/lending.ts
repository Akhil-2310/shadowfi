export type Bucket = bigint;

/**
 * Greedy descending split: given a total and a sorted list of allowed buckets,
 * produce a multiset of bucket sizes whose sum equals the total, preferring
 * the largest buckets first. Returns null if the total cannot be expressed
 * exactly with the available denominations.
 */
export const splitIntoBuckets = (total: bigint, buckets: readonly Bucket[]): Bucket[] | null => {
  if (total <= 0n) return [];
  const sorted = [...buckets].sort((a, b) => (a > b ? -1 : a < b ? 1 : 0));
  const chosen: Bucket[] = [];
  let remaining = total;
  for (const b of sorted) {
    while (remaining >= b) {
      chosen.push(b);
      remaining -= b;
    }
  }
  return remaining === 0n ? chosen : null;
};

export const formatBps = (bps: bigint | number) => `${(Number(bps) / 100).toFixed(2)}%`;

export const LOAN_STATUS_LABELS = ["Open", "Funded", "Repaid", "Defaulted", "Cancelled"] as const;
export type LoanStatusLabel = (typeof LOAN_STATUS_LABELS)[number];

export const statusLabel = (status: number | bigint): LoanStatusLabel => LOAN_STATUS_LABELS[Number(status)] ?? "Open";

export const statusBadgeClass = (status: number | bigint): string => {
  switch (Number(status)) {
    case 0:
      return "badge-info";
    case 1:
      return "badge-warning";
    case 2:
      return "badge-success";
    case 3:
      return "badge-error";
    case 4:
      return "badge-ghost";
    default:
      return "badge-ghost";
  }
};
