import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Address, Hex, encodeFunctionData } from "viem";
import { usePublicClient } from "wagmi";
import { LineaEstimateGasCall, LineaGasQuote, lineaGasQuote } from "~~/utils/lineaGas";

export type UseLineaGasQuoteArgs = {
  /** Sender whose Karma state determines gasless vs premium. */
  from?: Address;
  to?: Address;
  value?: bigint;
  data?: Hex;
  /** Auto re-estimate every N ms. Karma quota refreshes by epoch, so re-quote near send time. */
  refreshIntervalMs?: number;
  /** Skip the quote entirely (e.g. user hasn't connected yet). */
  enabled?: boolean;
};

export type UseLineaGasQuoteResult = {
  data: LineaGasQuote | null;
  error: Error | null;
  isLoading: boolean;
  refetch: () => Promise<LineaGasQuote | null>;
};

/**
 * Reactive `linea_estimateGas` quote.
 *
 * Use when you want to show a user what a transaction will cost *before* they
 * sign. For the submission path itself, call `refetch()` one more time and
 * spread the returned fee fields into `writeContract`, so the sender gets
 * a Karma-accurate fee at the exact moment the tx leaves the app.
 */
export const useLineaGasQuote = ({
  from,
  to,
  value,
  data,
  refreshIntervalMs = 15_000,
  enabled = true,
}: UseLineaGasQuoteArgs): UseLineaGasQuoteResult => {
  const client = usePublicClient();
  const [quote, setQuote] = useState<LineaGasQuote | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  // Latch the latest args in a ref so the poll interval always reads current values.
  const argsRef = useRef<LineaEstimateGasCall | null>(null);
  argsRef.current = from ? { from, to, value, data } : null;

  const active = enabled && Boolean(client && from);

  const run = useCallback(async (): Promise<LineaGasQuote | null> => {
    if (!client || !argsRef.current) return null;
    setIsLoading(true);
    try {
      const next = await lineaGasQuote(client, argsRef.current);
      setQuote(next);
      setError(null);
      return next;
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [client]);

  useEffect(() => {
    if (!active) {
      setQuote(null);
      return;
    }
    void run();
  }, [active, run, from, to, value, data]);

  useEffect(() => {
    if (!active || !refreshIntervalMs) return;
    const id = setInterval(() => {
      void run();
    }, refreshIntervalMs);
    return () => clearInterval(id);
  }, [active, refreshIntervalMs, run]);

  return useMemo(() => ({ data: quote, error, isLoading, refetch: run }), [quote, error, isLoading, run]);
};

export type UseLineaContractGasQuoteArgs<TAbi extends readonly unknown[]> = {
  from?: Address;
  address?: Address;
  abi: TAbi;
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
  refreshIntervalMs?: number;
  enabled?: boolean;
};

/** Same as {@link useLineaGasQuote} but for contract calls — encodes calldata for you. */
export const useLineaContractGasQuote = <TAbi extends readonly unknown[]>({
  from,
  address,
  abi,
  functionName,
  args,
  value,
  refreshIntervalMs,
  enabled = true,
}: UseLineaContractGasQuoteArgs<TAbi>): UseLineaGasQuoteResult => {
  const data = useMemo<Hex | undefined>(() => {
    if (!abi || !functionName) return undefined;
    try {
      return encodeFunctionData({ abi, functionName, args } as never) as Hex;
    } catch {
      return undefined;
    }
  }, [abi, functionName, args]);

  return useLineaGasQuote({
    from,
    to: address,
    value,
    data,
    refreshIntervalMs,
    enabled: enabled && Boolean(address && data),
  });
};
