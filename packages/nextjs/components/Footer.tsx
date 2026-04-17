"use client";

import React from "react";
import Link from "next/link";
import { useFetchNativeCurrencyPrice } from "@scaffold-ui/hooks";
import { hardhat } from "viem/chains";
import {
  ArrowTopRightOnSquareIcon,
  CurrencyDollarIcon,
  EyeSlashIcon,
  MagnifyingGlassIcon,
  SparklesIcon,
} from "@heroicons/react/24/outline";
import { SwitchTheme } from "~~/components/SwitchTheme";
import { Faucet } from "~~/components/scaffold-eth";
import { useTargetNetwork } from "~~/hooks/scaffold-eth/useTargetNetwork";
import { STATUS_HOODI_KARMA, statusHoodi } from "~~/utils/chains";

/**
 * Branded footer for the privacy lending app.
 *
 * Two layers:
 *   - A floating dev toolbar (price · faucet · theme) pinned to the bottom,
 *     only useful while developing / testing. Identical to SE-2's behavior
 *     but cleaned up.
 *   - A normal footer strip underneath that links to the actual building
 *     blocks of the system (Status Network, Karma contract, deployed lending
 *     contracts) instead of SE-2 boilerplate.
 */
export const Footer = () => {
  const { targetNetwork } = useTargetNetwork();
  const isLocalNetwork = targetNetwork.id === hardhat.id;
  const isHoodi = targetNetwork.id === statusHoodi.id;
  const { price: nativeCurrencyPrice } = useFetchNativeCurrencyPrice();

  return (
    <footer className="mt-12">
      {/* Floating dev toolbar — only takes real estate if there's something to show. */}
      <div className="fixed flex justify-between items-center w-full z-10 p-4 bottom-0 left-0 pointer-events-none">
        <div className="flex flex-col md:flex-row gap-2 pointer-events-auto">
          {nativeCurrencyPrice > 0 && (
            <div className="btn btn-primary btn-sm font-normal gap-1 cursor-auto pointer-events-none">
              <CurrencyDollarIcon className="h-4 w-4" />
              <span>{nativeCurrencyPrice.toFixed(2)}</span>
            </div>
          )}
          {isLocalNetwork && (
            <>
              <Faucet />
              <Link href="/blockexplorer" passHref className="btn btn-primary btn-sm font-normal gap-1">
                <MagnifyingGlassIcon className="h-4 w-4" />
                <span>Block Explorer</span>
              </Link>
            </>
          )}
        </div>
        <SwitchTheme className={`pointer-events-auto ${isLocalNetwork ? "self-end md:self-auto" : ""}`} />
      </div>

      {/* Actual content footer. Lifted above the floating toolbar so it doesn't
          fight for space on mobile. */}
      <div className="border-t border-base-300 bg-base-200/60 backdrop-blur pb-24 lg:pb-14 pt-8 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-md bg-primary/10 text-primary">
                  <EyeSlashIcon className="h-4 w-4" />
                </div>
                <span className="font-semibold">ShadowFi</span>
              </div>
              <p className="text-xs opacity-70 leading-relaxed">
                Private, gasless, Karma-gated lending on the Status Network. Loans are real and on-chain — identity is
                not.
              </p>
              <div className="flex items-center gap-2 text-xs opacity-70">
                <span className="inline-flex h-2 w-2 rounded-full bg-success"></span>
                <span>
                  Target network: <span className="font-medium">{targetNetwork.name}</span>
                </span>
              </div>
            </div>

            <div className="space-y-2 text-sm">
              <div className="font-semibold opacity-80">Explore</div>
              <ul className="space-y-1">
                <li>
                  <Link href="/borrow" className="link link-hover opacity-80 hover:opacity-100">
                    Borrow
                  </Link>
                </li>
                <li>
                  <Link href="/market" className="link link-hover opacity-80 hover:opacity-100">
                    Market
                  </Link>
                </li>
                <li>
                  <Link href="/my-loans" className="link link-hover opacity-80 hover:opacity-100">
                    My loans
                  </Link>
                </li>
                <li>
                  <Link href="/karma" className="link link-hover opacity-80 hover:opacity-100">
                    Karma
                  </Link>
                </li>
                <li>
                  <Link href="/agent" className="link link-hover opacity-80 hover:opacity-100">
                    Agent <span className="badge badge-xs badge-outline ml-1">soon</span>
                  </Link>
                </li>
              </ul>
            </div>

            <div className="space-y-2 text-sm">
              <div className="font-semibold opacity-80">Building blocks</div>
              <ul className="space-y-1">
                <li>
                  <a
                    className="link link-hover opacity-80 hover:opacity-100 inline-flex items-center gap-1"
                    href="https://docs.status.network"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Status Network docs <ArrowTopRightOnSquareIcon className="h-3 w-3" />
                  </a>
                </li>
                <li>
                  <a
                    className="link link-hover opacity-80 hover:opacity-100 inline-flex items-center gap-1"
                    href="https://docs.status.network/build-for-karma/guides/gasless-integration"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Gasless integration guide <ArrowTopRightOnSquareIcon className="h-3 w-3" />
                  </a>
                </li>
                {isHoodi && (
                  <li>
                    <a
                      className="link link-hover opacity-80 hover:opacity-100 inline-flex items-center gap-1"
                      href={`${statusHoodi.blockExplorers.default.url}/address/${STATUS_HOODI_KARMA.karma}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <SparklesIcon className="h-3 w-3" /> Karma contract{" "}
                      <ArrowTopRightOnSquareIcon className="h-3 w-3" />
                    </a>
                  </li>
                )}
                <li>
                  <a
                    className="link link-hover opacity-80 hover:opacity-100 inline-flex items-center gap-1"
                    href={targetNetwork.blockExplorers?.default.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Block explorer <ArrowTopRightOnSquareIcon className="h-3 w-3" />
                  </a>
                </li>
              </ul>
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-base-300 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs opacity-60">
            <span>Privacy primitive — hackathon build. Use at your own risk.</span>
            <span>No custody · No KYC · No on-chain identity trail</span>
          </div>
        </div>
      </div>
    </footer>
  );
};
