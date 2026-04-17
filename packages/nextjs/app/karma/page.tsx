"use client";

import Link from "next/link";
import { Address as AddressDisplay } from "@scaffold-ui/components";
import type { NextPage } from "next";
import { formatEther } from "viem";
import { useAccount, useChainId, useReadContract } from "wagmi";
import { ArrowPathIcon, ArrowTopRightOnSquareIcon, SparklesIcon } from "@heroicons/react/24/outline";
import { useScaffoldReadContract } from "~~/hooks/scaffold-eth";
import { STATUS_HOODI_KARMA, statusHoodi } from "~~/utils/chains";

const KARMA_TIERS_ABI = [
  {
    inputs: [{ name: "karmaBalance", type: "uint256" }],
    name: "getTierIdByKarmaBalance",
    outputs: [{ name: "", type: "uint8" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "tierId", type: "uint8" }],
    name: "getTierById",
    outputs: [
      {
        components: [
          { name: "minKarma", type: "uint256" },
          { name: "maxKarma", type: "uint256" },
          { name: "name", type: "string" },
          { name: "txPerEpoch", type: "uint32" },
        ],
        name: "",
        type: "tuple",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
] as const;

const KARMA_DECIMALS = 18n;

const formatKarma = (raw?: bigint) => {
  if (raw === undefined) return "—";
  const whole = raw / 10n ** KARMA_DECIMALS;
  const frac = raw % 10n ** KARMA_DECIMALS;
  if (frac === 0n) return whole.toString();
  const fracStr = (frac + 10n ** KARMA_DECIMALS).toString().slice(1, 5).replace(/0+$/, "");
  return fracStr ? `${whole}.${fracStr}` : whole.toString();
};

const KarmaPage: NextPage = () => {
  const { address } = useAccount();
  const chainId = useChainId();
  const onHoodi = chainId === statusHoodi.id;

  const { data: karma, refetch: refetchKarma } = useScaffoldReadContract({
    contractName: "Karma",
    functionName: "balanceOf",
    args: [address],
  });

  const { data: maxBorrow } = useScaffoldReadContract({
    contractName: "BucketLending",
    functionName: "getMaxBorrow",
    args: [karma ?? 0n],
  });

  const { data: tierId } = useReadContract({
    address: STATUS_HOODI_KARMA.karmaTiers as `0x${string}`,
    abi: KARMA_TIERS_ABI,
    functionName: "getTierIdByKarmaBalance",
    args: [karma ?? 0n],
    chainId: statusHoodi.id,
    query: { enabled: onHoodi && karma !== undefined },
  });

  const { data: tier } = useReadContract({
    address: STATUS_HOODI_KARMA.karmaTiers as `0x${string}`,
    abi: KARMA_TIERS_ABI,
    functionName: "getTierById",
    args: [tierId ?? 0],
    chainId: statusHoodi.id,
    query: { enabled: onHoodi && tierId !== undefined },
  });

  // bps per 1 whole Karma = 10 (matches contract constant)
  const karmaDiscountBps = karma !== undefined ? (karma * 10n) / 10n ** KARMA_DECIMALS : 0n;

  return (
    <div className="max-w-3xl mx-auto px-6 py-10 w-full">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 rounded-lg bg-primary/10 text-primary">
          <SparklesIcon className="h-6 w-6" />
        </div>
        <h1 className="text-3xl font-bold">Your Karma</h1>
      </div>

      {!address ? (
        <div className="alert alert-info">Connect a wallet to see your Karma.</div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="stat bg-base-200 rounded-box">
              <div className="stat-title">Primary identity</div>
              <div className="stat-value text-base mt-1">
                <AddressDisplay address={address} />
              </div>
              <div className="stat-desc">Karma is read from this address. Your loans use stealth addresses.</div>
            </div>
            <div className="stat bg-base-200 rounded-box">
              <div className="stat-title">Karma balance</div>
              <div className="stat-value text-primary">{formatKarma(karma as bigint | undefined)}</div>
              <div className="stat-desc">
                <button className="btn btn-xs btn-ghost" onClick={() => refetchKarma()}>
                  <ArrowPathIcon className="h-3 w-3" />
                  Refresh
                </button>
              </div>
            </div>
            <div className="stat bg-base-200 rounded-box">
              <div className="stat-title">Borrow cap per bucket</div>
              <div className="stat-value">{maxBorrow !== undefined ? `${formatEther(maxBorrow)} ETH` : "—"}</div>
              <div className="stat-desc">0.05 ETH of capacity per 1 Karma.</div>
            </div>
            <div className="stat bg-base-200 rounded-box">
              <div className="stat-title">Interest discount</div>
              <div className="stat-value">{`${karmaDiscountBps.toString()} bps`}</div>
              <div className="stat-desc">10 bps off your base rate per 1 Karma.</div>
            </div>
          </div>

          {onHoodi && tier && (
            <div className="card bg-base-100 shadow-xl mt-4">
              <div className="card-body">
                <h2 className="card-title">Status Karma tier</h2>
                <div className="text-sm">
                  Network tier: <span className="badge badge-primary">{tier.name || `Tier ${tierId ?? 0}`}</span>
                </div>
                <div className="text-sm opacity-70">
                  Controls your gasless transaction quota on Status Network ({tier.txPerEpoch?.toString() ?? 0} tx /
                  epoch).
                </div>
              </div>
            </div>
          )}
        </>
      )}

      <div className="divider mt-8">Earn more Karma</div>

      <div className="card bg-base-100 shadow-xl">
        <div className="card-body text-sm leading-relaxed">
          <p>
            Karma is a soulbound ERC-20 issued by the Status Network protocol. It cannot be bought or transferred — you
            earn it by actually using the network (staking SNT, bridging assets, providing liquidity, using apps, or
            paying premium gas).
          </p>
          <ul className="list-disc pl-5 opacity-80">
            <li>This lending app reads your Karma directly from the protocol contract.</li>
            <li>
              No faucet here — reputation has to be real, or the privacy+credit design degenerates into a sybil farm.
            </li>
            <li>On local hardhat, tests use a minimal `MockKarma` stub so the permit flow is exercisable offline.</li>
          </ul>
          <div className="flex flex-wrap gap-2 mt-3">
            <a
              className="btn btn-sm btn-outline"
              href="https://docs.status.network/build-for-karma/why-status-network"
              target="_blank"
              rel="noreferrer"
            >
              Earning Karma <ArrowTopRightOnSquareIcon className="h-3 w-3" />
            </a>
            {onHoodi && (
              <Link
                className="btn btn-sm btn-outline"
                href={`${statusHoodi.blockExplorers.default.url}/address/${STATUS_HOODI_KARMA.karma}`}
                target="_blank"
              >
                View Karma contract <ArrowTopRightOnSquareIcon className="h-3 w-3" />
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default KarmaPage;
