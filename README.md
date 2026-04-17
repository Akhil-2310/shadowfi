# ShadowFi

**Private, gasless, Karma-gated lending on the Status Network.**

ShadowFi is a privacy-first lending borrowing primitive. Borrowers keep their primary identity off-chain and borrow through deterministically derived **stealth addresses**. Credit is underwritten by **Karma** (Status Network's non-transferable reputation), and loans are normalized into **fixed-size buckets** so on-chain observers can see loans — but not *your* loans.

It's built to showcase three things that are only practical on Status Network:

1. **Protocol-level gasless execution** (via `linea_estimateGas` + Karma). No paymasters, no relayers.
2. **Karma as sybil-resistant, read-only credit** — no collateral, no KYC, no slashing.
3. **Practical privacy without heavy ZK** — stealth addresses + bucketing + decoys + off-chain signed permits.


---

## Table of contents

- [Why ShadowFi](#why-shadowfi)
- [How it works](#how-it-works)
- [Architecture](#architecture)
- [Smart contracts](#smart-contracts)
- [Frontend](#frontend)
- [Tech stack](#tech-stack)
- [Getting started](#getting-started)
- [Deploy to Status Hoodi](#deploy-to-status-hoodi)
- [Deployed addresses](#deployed-addresses-status-hoodi)
- [Privacy model — what is and isn't private](#privacy-model)
- [Economic model](#economic-model)
- [Roadmap](#roadmap)
- [Project layout](#project-layout)
- [Credits](#credits)

---

## Why ShadowFi

Public-ledger DeFi lending leaks an enormous amount of information:

- **Positions are legible.** Anyone can reconstruct your total exposure, strategy, and counterparties.
- **Reputation requires identity.** Undercollateralized credit usually means KYC, which kills the permissionless premise.
- **Gas friction rules out agents.** Autonomous lenders and liquidators need to send many small transactions cheaply.

ShadowFi addresses all three with mechanisms that compose natively on Status Network:

| Problem | ShadowFi mechanism |
| --- | --- |
| Loans link back to your identity | **Stealth addresses** — one fresh keypair per loan, derived from a signature of your main wallet |
| Loan sizes leak total exposure | **Bucket-only sizing** (0.1 / 0.5 / 1 ETH). Larger asks are split across independent stealths |
| Undercollateralized credit needs KYC | **Karma-gated borrowing** — your reputation token sets the cap and the discount |
| Gas ruins micro-actions and bots | **Gasless fee path** via `linea_estimateGas` on Status Network |
| Gas top-ups leak the main → stealth edge | **StealthDisperser** — batched, uniform, decoy-padded funding in a single tx |

---

## How it works

End-to-end borrower flow:

```
┌─────────────┐  sign seed msg  ┌──────────────────┐
│ Main wallet │ ───────────────▶│ Stealth vault    │  (client-side only)
│  (Karma)    │                 │  HMAC(seed, idx) │
└──────┬──────┘                 └────────┬─────────┘
       │  EIP-712 BorrowPermit            │ derive stealth_i
       │  (stealth, amount, apr, ...)     ▼
       │                           ┌───────────────┐
       │                           │  Stealth_i    │
       │                           │ (fresh keypair)│
       │                           └──────┬────────┘
       │                                  │ requestLoanWithPermit(sig)
       │                                  ▼
       │                         ┌──────────────────┐
       │                         │  BucketLending   │
       │                         │                  │
       │                         │  ecrecover(sig)  │
       │                         │  karma.balanceOf │
       │                         │  gate + discount │
       │                         └──────────────────┘
       ▼
(main wallet is never a `msg.sender` to BucketLending)
```

Seven deliberate steps:

1. **Unlock the stealth vault.** Main wallet signs one deterministic message. The signature is hashed into a 32-byte seed stored only in that tab's memory. Fresh stealth keypairs are derived at indices `0, 1, 2…` via HMAC.
2. **Split big asks into buckets.** A request for `1.3 ETH` becomes `1 + 0.1 + 0.1 + 0.1`, one bucket per stealth, with independent EIP-712 salts.
3. **Sign a borrow permit per stealth.** Main wallet signs `BorrowPermit(stealth, bucket, baseBps, duration, deadline, salt)` off-chain. The permit authorizes exactly *that* stealth to open exactly *that* bucket.
4. **(Optional) Batched gas top-up.** If any stealth is *not* on the gasless tier, the UI fans out a uniform top-up to all real stealths **plus decoys** in a single `StealthDisperser.batch(...)` call so observers cannot pair a top-up with a loan amount.
5. **Stealth submits the loan.** Each stealth calls `requestLoanWithPermit(...)`. The contract `ecrecover`s the signer, reads their Karma via `karma.balanceOf(signer)`, enforces `MIN_KARMA`, borrow cap, and interest discount. **The signer address is never stored or emitted.**
6. **Lenders fund.** Anyone can `fundLoan(id)` with ETH. When fully funded, principal is auto-transferred to the stealth, `dueTime` is set, and the loan moves to `Funded`. Overpayment is refunded in-call.
7. **Stealth repays.** The same stealth calls `repayLoan(id)` with `principal + interest`. The contract pro-rata distributes to lenders in the same tx.

The default path (`markDefault`) is permissionless once `dueTime` passes, but has no compensation mechanism — there is no Karma slashing and no collateral to seize. That's deliberate (see [Privacy model](#privacy-model)).

---

## Architecture

```
packages/
├── hardhat/                    # Solidity contracts + hardhat-deploy scripts
│   ├── contracts/
│   │   ├── BucketLending.sol   # Core lending contract (EIP-712, OZ)
│   │   ├── StealthDisperser.sol# Batched, decoy-padded gas top-ups
│   │   └── MockKarma.sol       # Local-only Karma stub (NOT deployed on Hoodi)
│   ├── deploy/
│   │   ├── 01_deploy_bucket_lending.ts  # Points at real Karma on Hoodi
│   │   └── 02_deploy_stealth_disperser.ts
│   └── hardhat.config.ts       # Networks incl. statusHoodi / statusSepolia
│
└── nextjs/                     # Scaffold-ETH 2 frontend
    ├── app/
    │   ├── page.tsx            # Landing + pillars + end-to-end timeline
    │   ├── borrow/             # Permit flow + batched funding UX
    │   ├── market/             # Open loans + funding
    │   ├── my-loans/           # Borrower + lender dashboards
    │   ├── karma/              # Live Karma lookup + borrow preview
    │   └── agent/              # Autonomous lender (preview / coming soon)
    ├── components/
    │   ├── Header.tsx, Footer.tsx
    │   ├── StealthVault.tsx    # Unlock + preview next stealth
    │   └── FeeBadge.tsx        # Karma-aware gasless/premium indicator
    ├── hooks/
    │   ├── useStealthWallet.ts # Deterministic stealth derivation
    │   └── useLineaGasQuote.ts # Wraps linea_estimateGas
    └── utils/
        ├── chains.ts           # statusHoodi chain def w/ custom fees hook
        ├── lineaGas.ts         # linea_estimateGas + fallbacks
        ├── stealthBatchFunding.ts  # StealthDisperser planning + execution
        └── stealth.ts          # Keypair derivation primitives
```

---

## Smart contracts

### `BucketLending.sol`

The entire lending primitive. ~395 LOC, `ReentrancyGuard` + `EIP712`.

Key constants (immutable in code, explicit on purpose):

| Constant | Value | Meaning |
| --- | --- | --- |
| `MIN_KARMA` | `1 KARMA` | Minimum reputation to borrow any bucket |
| `KARMA_BORROW_RATE` | `0.05 ETH / KARMA` | Per-bucket borrow cap scales linearly with Karma |
| `MIN_INTEREST_BPS` | `50` (0.5%) | Floor after Karma-based discount |
| `INTEREST_DISCOUNT_BPS_PER_KARMA` | `10` (0.1%) | Discount off base rate per 1 Karma |
| `buckets` | `[0.1, 0.5, 1] ETH` | Only these denominations are valid |

---

## Frontend

Five user-facing pages:

- **`/borrow`** — Unlock vault → pick amount → auto-split into buckets → sign N permits → (optional) single batched top-up → N `requestLoanWithPermit` calls from N fresh stealths.
- **`/market`** — All open loans, filterable, with live Karma-aware gasless/premium fee preview before you hit **Fund**. Shows market stats (open requests, total requested/funded, avg APR).
- **`/my-loans`** — Two tabs. **As borrower**: every stealth you've ever derived scanned for loans (via on-chain `getLoans`), showing open / funded / repaid and outstanding owed. **As lender**: every loan you've funded via on-chain `getLenders(loanId)` multicalls, showing your pro-rata capital out and repaid.
- **`/karma`** — Looks up `karma.balanceOf(yourMainWallet)` live and previews borrow cap and discount tiers.
- **`/agent`** (preview) — Client-side lending bot scaffolding. UI is complete; auto-funding is gated off until RLN-backed session signing lands.

Karma-aware gas UX is threaded everywhere it matters through `useLineaGasQuote` + `FeeBadge`, so the user always sees "Gasless" or the exact premium fee before they send.

---

## Tech stack

- **Solidity** 0.8.24, **OpenZeppelin Contracts** (`EIP712`, `ECDSA`, `ReentrancyGuard`)
- **Hardhat** + **hardhat-deploy** + **hardhat-verify**
- **Next.js** (App Router) + **TypeScript** + **Tailwind** + **DaisyUI**
- **wagmi** + **viem** + **RainbowKit**
- **Scaffold-ETH 2** as the base toolkit (custom hooks, typed contract helpers, auto-ABI export)
- **Status Network Hoodi** (chain 374), fees estimated via **`linea_estimateGas`** with `eth_estimateGas` fallback

---

## Getting started

### Requirements

- Node **≥ v20.18.3**
- Yarn (v1 or v2+)
- Git

### 1. Install

```bash
git clone <this repo>
cd korea
yarn install
```

### 2. Run locally (hardhat node)

Three terminals:

```bash
yarn chain                 # local hardhat node
yarn deploy                # deploys BucketLending + StealthDisperser + MockKarma,
                           # seeds deployer with 20 Karma
yarn start                 # Next.js at http://localhost:3000
```

On a local network the deploy script drops a **`MockKarma`** so you can exercise the full flow (Karma gating, borrow-cap arithmetic, interest discount) without needing Status Hoodi.

### 3. Compile / test / lint

```bash
yarn compile               # hardhat compile
yarn hardhat:test          # contract tests
yarn lint
yarn format
yarn next:build            # production build of the frontend
```

---

## Deploy to Status Hoodi

1. Put your deployer private key in `packages/hardhat/.env`:

   ```env
   DEPLOYER_PRIVATE_KEY=0xabc123...
   ```

2. Deploy:

   ```bash
   yarn deploy --network statusHoodi
   ```

   This will:
   - Deploy `BucketLending` with real Karma (`0x0700be6f329cc48c38144f71c898b72795db6c1b`).
   - Deploy `BucketLending` with buckets `[0.1, 0.5, 1 ETH]`.
   - Deploy `StealthDisperser`.
   - Regenerate `packages/nextjs/contracts/deployedContracts.ts` so the frontend picks up the new addresses automatically.

3. Verify (optional):

   ```bash
   yarn verify --network statusHoodi
   ```

4. Run the frontend against Hoodi:

   ```bash
   yarn start
   ```

   `scaffold.config.ts` already targets `statusHoodi` with a `public.hoodi.rpc.status.network` override.

---

## Deployed addresses (Status Hoodi)

Current live deployment used by the frontend. All ShadowFi contracts are **verified on Hoodiscan** — the links go straight to the source tab.

| Contract | Address | Status |
| --- | --- | --- |
| `BucketLending` | [`0x2acd323f5a715Af37b9dC0E5e9d79897c9669d8C`](https://hoodiscan.status.network/address/0x2acd323f5a715Af37b9dC0E5e9d79897c9669d8C#code) | ✅ verified |
| `StealthDisperser` | [`0xca45Eb8CF0fB1Ad779148E3fe15820AD0beD375b`](https://hoodiscan.status.network/address/0xca45Eb8CF0fB1Ad779148E3fe15820AD0beD375b#code) | ✅ verified |
| `Karma` | [`0x0700be6f329cc48c38144f71c898b72795db6c1b`](https://hoodiscan.status.network/address/0x0700be6f329cc48c38144f71c898b72795db6c1b) | ✅ verified |

---

## Privacy model

Be honest about what we do and don't claim:

**What is private**

- Your main wallet is **never** a `msg.sender` to `BucketLending`. All five state-changing functions (`requestLoanWithPermit`, `fundLoan`, `repayLoan`, `cancelLoan`, `markDefault`) can only be called by a stealth.
- The borrower's Karma-holder address is **never stored** and **never emitted** — only `ecrecover`'d inside a single call.
- Multi-bucket splits use **independent stealth keypairs** and **fresh EIP-712 salts**, so two loans from the same user are on-chain unrelated.
- When gasless is unavailable, the **batched disperser** mixes real stealths with decoys and uses a uniform per-recipient amount, breaking the per-loan main→stealth edge.

---

## Economic model

Principal + fixed (not annualized) interest. Given a bucket of size `P` and a Karma-adjusted rate `r` bps:

- Borrower owes: `P + P * r / 10_000` over `duration` seconds.
- Karma discount: `discountBps = karma * 10 / 1e18`, applied off the base rate, floored at `MIN_INTEREST_BPS = 50`.
- Borrow cap per bucket: `maxBorrow = karma * 0.05 ETH / 1 ETH`. You can still split *across* multiple buckets from multiple stealths, each individually cap-checked.
- Lender payout on repayment: `contribution_i * (P + interest) / P` — pro-rata on principal share.
- Lender payout on cancellation (loan never fully funded): `contribution_i` refunded in full.
- Lender payout on default: **zero**. See [Privacy model](#privacy-model).

---

## Roadmap

Near-term, in order of impact:

- [ ] **Agent mode** — unlock the `/agent` auto-funder behind an RLN-gated client session.
- [ ] **ZK borrow permits** — replace ECDSA `BorrowPermit` with a zk-SNARK over "I know a Karma ≥ N address" so the signer is never recoverable from calldata.
- [ ] **Per-loan re-quote at send time** — re-run `linea_estimateGas` just before `requestLoan`/`fundLoan` to avoid stale gasless assumptions when Karma state changes.
- [ ] **Lender privacy** — mirror the stealth pattern for `fundLoan` so lenders also transact from fresh addresses.
- [ ] **More buckets + stable unit** — add `0.25 / 2 / 5` ETH and a USDC-denominated variant.
- [ ] **Subgraph / Ponder indexer** — serve `/market` and `/my-loans` from an index instead of `getLoans()` + per-loan multicall.

---

## Project layout

```
korea/
├── packages/
│   ├── hardhat/           # Solidity + deploy scripts (see architecture above)
│   └── nextjs/            # Frontend
├── .agents/               # AI agent skills + guidance
├── AGENTS.md              # Coding-agent instructions (SE-2 conventions)
├── CLAUDE.md              # Pointer to AGENTS.md
└── README.md              # You are here
```

Useful yarn scripts (monorepo root):

| Command | What it does |
| --- | --- |
| `yarn chain` | Local hardhat node |
| `yarn deploy [--network X]` | Deploy all, regenerate frontend ABIs |
| `yarn start` | Next.js dev server |
| `yarn compile` | Compile contracts |
| `yarn hardhat:test` | Run contract tests |
| `yarn lint` / `yarn format` | Lint + format both packages |
| `yarn next:build` | Production build of the frontend |
| `yarn verify --network X` | Contract verification (Hoodiscan for `statusHoodi`) |
| `yarn account` / `yarn generate` / `yarn account:import` | Deployer key management |

---

## Credits

- Built for **buidl korea** on top of **[Scaffold-ETH 2](https://scaffoldeth.io)**.
- Runs on **[Status Network](https://status.network)** — gasless execution, Karma reputation, and Linea-style fee estimation.
- OpenZeppelin Contracts for `EIP712` / `ECDSA` / `ReentrancyGuard`.

> ShadowFi is a hackathon project — it is not audited, has no oracle, and has no liquidation mechanism. Do not use it with funds you're not prepared to lose.
