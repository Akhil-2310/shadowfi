"use client";

import Link from "next/link";
import { Address as AddressDisplay } from "@scaffold-ui/components";
import type { NextPage } from "next";
import { useAccount } from "wagmi";
import {
  ArrowRightIcon,
  ArrowTrendingUpIcon,
  BanknotesIcon,
  BoltIcon,
  CpuChipIcon,
  EyeSlashIcon,
  FingerPrintIcon,
  KeyIcon,
  LockClosedIcon,
  ScaleIcon,
  ShieldCheckIcon,
  SparklesIcon,
  UserCircleIcon,
  UsersIcon,
} from "@heroicons/react/24/outline";

type Pillar = {
  title: string;
  body: string;
  icon: React.ReactNode;
};

const PILLARS: Pillar[] = [
  {
    title: "Stealth wallets",
    body: "Borrow and repay through deterministically derived stealth addresses so loans can't be linked back to your primary identity or to each other.",
    icon: <EyeSlashIcon className="h-6 w-6" />,
  },
  {
    title: "Bucket-only sizing",
    body: "Loans are fixed to normalized denominations (0.1 / 0.5 / 1 ETH). Larger requests are automatically split across independent stealth addresses.",
    icon: <LockClosedIcon className="h-6 w-6" />,
  },
  {
    title: "Karma-based credit",
    body: "Borrow capacity and interest discounts scale with your non-transferable Karma score on Status Network. No collateral, no KYC.",
    icon: <SparklesIcon className="h-6 w-6" />,
  },
  {
    title: "Borrow & lend",
    body: "Borrowers use stealth addresses; lenders fund open buckets from their main wallet on the market and earn principal + interest on repayment. Optional agents auto-fund matching requests.",
    icon: <CpuChipIcon className="h-6 w-6" />,
  },
];

type Step = {
  title: string;
  body: string;
  icon: React.ReactNode;
};

const STEPS: Step[] = [
  {
    title: "Unlock your stealth vault",
    body: "Sign one message with your main wallet. We hash the signature into a 32-byte seed that lives only in this tab, and derive a fresh stealth keypair at every index.",
    icon: <KeyIcon className="h-5 w-5" />,
  },
  {
    title: "Sign a borrow permit",
    body: "Your main wallet signs an off-chain EIP-712 permit authorizing a specific stealth to borrow a specific bucket. The stealth sends the transaction — your main wallet never touches the lending contract.",
    icon: <FingerPrintIcon className="h-5 w-5" />,
  },
  {
    title: "Karma gates the bucket",
    body: "The contract ECDSA-recovers the signer, reads live Karma from Status Network, and enforces the borrow cap and interest discount. The signer's address is never stored and never emitted.",
    icon: <ShieldCheckIcon className="h-5 w-5" />,
  },
  {
    title: "Big asks get split",
    body: "Requests above the top bucket are split into independent permits across fresh stealth addresses with fresh salts. Observers see a portfolio of unrelated loans, not a position.",
    icon: <ScaleIcon className="h-5 w-5" />,
  },
  {
    title: "Lenders fund the bucket",
    body: "Any number of lenders top up the request. Once fully funded, the bucket transfers to the stealth borrower in a single on-chain move — no custody, no escrow middleman.",
    icon: <UsersIcon className="h-5 w-5" />,
  },
  {
    title: "Repay from the same stealth",
    body: "When due, the stealth address repays principal + interest. The contract splits the repayment pro-rata back to lenders — still no main-wallet interaction needed.",
    icon: <BoltIcon className="h-5 w-5" />,
  },
  {
    title: "No slashing, just reputation",
    body: "Karma on Status is read-only from external contracts, so we can't slash it — and writing identities on-chain would break privacy. Overdue loans are flagged; lenders price that risk.",
    icon: <SparklesIcon className="h-5 w-5" />,
  },
];

const CARDS: { href: string; title: string; body: string; icon: React.ReactNode }[] = [
  {
    href: "/borrow",
    title: "Borrow",
    body: "Unlock your stealth vault and open a Karma-gated loan request. Amounts over the top bucket are split automatically.",
    icon: <BanknotesIcon className="h-6 w-6" />,
  },
  {
    href: "/market",
    title: "Market",
    body: "Browse every open loan request, filter by APR/Karma, and fund the ones that match your thesis.",
    icon: <ArrowTrendingUpIcon className="h-6 w-6" />,
  },
  {
    href: "/my-loans",
    title: "My loans",
    body: "Track loans you've opened (as borrower) and funded (as lender). Repay from any of your stealth addresses.",
    icon: <UserCircleIcon className="h-6 w-6" />,
  },
  {
    href: "/karma",
    title: "Karma",
    body: "Read your live Karma balance and Status tier directly from the protocol. Earn more by using the network.",
    icon: <SparklesIcon className="h-6 w-6" />,
  },
  {
    href: "/agent",
    title: "Agent",
    body: "Toggle a client-side lending bot that auto-funds loans matching your heuristics in real time.",
    icon: <CpuChipIcon className="h-6 w-6" />,
  },
];

const Home: NextPage = () => {
  const { address: connectedAddress } = useAccount();

  return (
    <div className="flex flex-col grow">
      <section className="px-6 pt-12 pb-16 bg-gradient-to-b from-base-200 to-base-100">
        <div className="max-w-5xl mx-auto text-center">
          <div className="badge badge-primary badge-outline mb-4">Status Network · Gasless · Karma-gated</div>
          <h1 className="text-4xl md:text-6xl font-bold leading-tight">
            Borrow in stealth. Lend on the market. Reputation is based on KARMA.
          </h1>
          <p className="mt-4 text-lg opacity-80 max-w-3xl mx-auto">
            ShadowFi is a two-sided credit market on Status Network: borrow through stealth addresses and fixed-size
            buckets, or fund open requests and earn fixed interest when borrowers repay. Karma gates credit; onchain
            observers see loans — they don&apos;t see <em>your</em> loans as a borrower.
          </p>
          <div className="flex flex-wrap gap-3 justify-center mt-6">
            <Link href="/borrow" className="btn btn-primary">
              Borrow
            </Link>
            <Link href="/market" className="btn btn-secondary">
              Browse market
            </Link>
            <Link href="/karma" className="btn btn-ghost">
              Check my Karma
            </Link>
          </div>

          {connectedAddress && (
            <div className="mt-8 inline-flex items-center gap-2 px-4 py-2 rounded-full bg-base-100 shadow">
              <span className="text-sm opacity-70">Connected:</span>
              <AddressDisplay address={connectedAddress} />
            </div>
          )}
        </div>
      </section>

      <section className="px-6 py-12">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl font-bold text-center mb-8">Four pillars</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {PILLARS.map(p => (
              <div key={p.title} className="card bg-base-200">
                <div className="card-body">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-primary/10 text-primary">{p.icon}</div>
                    <h3 className="card-title">{p.title}</h3>
                  </div>
                  <p className="opacity-80">{p.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="px-6 py-12 bg-base-200">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl font-bold text-center mb-8">Jump in</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {CARDS.map(c => (
              <Link
                key={c.href}
                href={c.href}
                className="card bg-base-100 hover:shadow-xl transition-shadow border border-base-300"
              >
                <div className="card-body">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-secondary/10 text-secondary">{c.icon}</div>
                    <h3 className="card-title">{c.title}</h3>
                  </div>
                  <p className="opacity-80">{c.body}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="px-6 py-16">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-10">
            <div className="badge badge-outline mb-3">End-to-end flow</div>
            <h2 className="text-2xl md:text-3xl font-bold">How it works</h2>
            <p className="opacity-70 mt-2 max-w-2xl mx-auto text-sm">
              Borrower path: from permit to repayment via stealth. Lender path: fund open loans on the market and
              receive pro-rata payouts when due. Below focuses on the borrower flow — lenders simply connect and fund.
            </p>
          </div>

          <ol className="relative border-l border-base-300 ml-4 md:ml-6 space-y-6">
            {STEPS.map((step, i) => (
              <li key={step.title} className="ml-8 md:ml-10">
                <span className="absolute -left-4 md:-left-5 flex items-center justify-center w-8 h-8 md:w-10 md:h-10 rounded-full bg-primary text-primary-content ring-4 ring-base-100 shadow">
                  <span className="text-sm md:text-base font-bold">{i + 1}</span>
                </span>
                <div className="card bg-base-100 border border-base-300 shadow-sm hover:shadow-md transition-shadow">
                  <div className="card-body py-4">
                    <div className="flex items-center gap-2">
                      <span className="text-primary">{step.icon}</span>
                      <h3 className="font-semibold text-base md:text-lg">{step.title}</h3>
                    </div>
                    <p className="text-sm opacity-80">{step.body}</p>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="px-6 py-16 bg-gradient-to-br from-primary/10 via-base-200 to-secondary/10">
        <div className="max-w-4xl mx-auto">
          <div className="card bg-base-100 border border-base-300 shadow-xl overflow-hidden">
            <div className="card-body p-8 md:p-10">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
                <div className="max-w-xl">
                  <div className="badge badge-primary badge-outline mb-3">Ready when you are</div>
                  <h2 className="text-2xl md:text-3xl font-bold">
                    Borrow with stealth — or fund the market from your wallet.
                  </h2>
                  <p className="opacity-80 mt-3 text-sm md:text-base">
                    Borrowers: unlock a vault, sign permits, repay from stealth — your main wallet never calls the
                    contract. Lenders: browse open buckets, fund with ETH, earn principal + interest when loans repay.
                    The Status Network handles Karma-aware gas and spam resistance.
                  </p>
                </div>
                <div className="flex flex-col sm:flex-row md:flex-col gap-3">
                  <Link href="/borrow" className="btn btn-primary gap-2">
                    Borrow now <ArrowRightIcon className="h-4 w-4" />
                  </Link>
                  <Link href="/market" className="btn btn-outline gap-2">
                    Fund a loan <ArrowRightIcon className="h-4 w-4" />
                  </Link>
                </div>
              </div>
              <div className="divider my-4" />
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
                <div className="flex items-start gap-2">
                  <EyeSlashIcon className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                  <div>
                    <div className="font-semibold">No position leakage</div>
                    <div className="opacity-70 text-xs">
                      Bucketed loans + stealth fan-out break balance reconstruction.
                    </div>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <BoltIcon className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                  <div>
                    <div className="font-semibold">Gasless when eligible</div>
                    <div className="opacity-70 text-xs">
                      Karma holders get zero-fee execution via <code>linea_estimateGas</code>.
                    </div>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <ShieldCheckIcon className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                  <div>
                    <div className="font-semibold">Karma &amp; yield</div>
                    <div className="opacity-70 text-xs">
                      Borrow caps and rate discounts scale with Karma. Lenders earn fixed interest on repaid loans — no
                      stealth required to fund.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

export default Home;
