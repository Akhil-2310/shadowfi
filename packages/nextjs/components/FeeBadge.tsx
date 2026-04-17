import { formatGwei } from "viem";
import { LineaGasQuote } from "~~/utils/lineaGas";

type FeeBadgeProps = {
  quote: LineaGasQuote | null;
  isLoading?: boolean;
  error?: Error | null;
  /** Optional label prefix, e.g. "Borrow" -> "Borrow: Gasless". */
  label?: string;
  className?: string;
};

/**
 * Renders the three fee states the Status gasless guide asks builders to surface:
 *   1. Gasless  — base + priority = 0 (Karma quota hit)
 *   2. Premium  — deny-listed / quota-exceeded sender
 *   3. Standard — normal L2 fees
 *
 * Always driven by a {@link LineaGasQuote} sourced from `linea_estimateGas`.
 */
export const FeeBadge = ({ quote, isLoading, error, label, className }: FeeBadgeProps) => {
  const prefix = label ? `${label}: ` : "";
  const wrap = (content: React.ReactNode, tone: "success" | "warning" | "info" | "ghost" | "error") => (
    <span
      className={`badge badge-${tone} ${tone === "ghost" ? "" : "badge-outline"} gap-1 py-3 ${className ?? ""}`.trim()}
    >
      {content}
    </span>
  );

  if (error) return wrap(<span>{prefix}fee estimate failed</span>, "error");
  if (isLoading && !quote) return wrap(<span>{prefix}estimating gas…</span>, "ghost");
  if (!quote) return null;

  if (quote.isGasless) {
    return wrap(
      <>
        <span aria-hidden>⚡</span>
        <span>{prefix}Gasless</span>
      </>,
      "success",
    );
  }

  if (quote.isPremium) {
    return wrap(
      <span>
        {prefix}Premium · {formatGwei(quote.maxFeePerGas)} gwei
      </span>,
      "warning",
    );
  }

  return wrap(
    <span>
      {prefix}~{formatGwei(quote.maxFeePerGas)} gwei
    </span>,
    "info",
  );
};
