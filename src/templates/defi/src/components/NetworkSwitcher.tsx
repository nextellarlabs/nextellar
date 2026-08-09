"use client";

import React, { useState, useEffect } from "react";
import { useWalletConfig, useWallet } from "../contexts/WalletProvider";
import { NETWORKS } from "../config/networks";

export default function NetworkSwitcher() {
  const [mounted, setMounted] = useState(false);
  const config = useWalletConfig();
  const wallet = useWallet();

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || !config || !config.switchNetwork) {
    return null;
  }

  const { activeNetworkKey, switchNetwork } = config;

  const handleNetworkChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newNetwork = e.target.value;
    if (newNetwork !== activeNetworkKey) {
      if (wallet?.connected) {
        if (
          !window.confirm(
            "Switching networks will disconnect your wallet. Continue?"
          )
        ) {
          return;
        }
      }
      switchNetwork(newNetwork);
    }
  };

  const isTestnet = activeNetworkKey === "testnet";

  return (
    <div className="relative group">
      <div className="flex items-center gap-3 bg-white/5 dark:bg-black/20 backdrop-blur-md rounded-full px-4 py-2 border border-gray-200/50 dark:border-white/10 hover:border-gray-300 dark:hover:border-white/20 transition-all shadow-sm">
        <div className="flex items-center gap-2">
          <div className="relative">
            <div
              className={`w-2.5 h-2.5 rounded-full ${
                isTestnet ? "bg-green-500" : "bg-orange-500"
              }`}
            />
            <div
              className={`absolute inset-0 w-2.5 h-2.5 rounded-full animate-ping opacity-75 ${
                isTestnet ? "bg-green-400" : "bg-orange-400"
              }`}
            />
          </div>
          <span className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 hidden sm:inline">
            Network
          </span>
        </div>
        
        <div className="h-4 w-[1px] bg-gray-200 dark:bg-white/10" />

        <select
          value={activeNetworkKey}
          onChange={handleNetworkChange}
          className="bg-transparent border-none text-sm font-semibold focus:ring-0 cursor-pointer text-gray-900 dark:text-gray-100 outline-none pr-2 appearance-none"
        >
          <option value="testnet" className="bg-white dark:bg-gray-900">{NETWORKS.testnet.name}</option>
          <option value="mainnet" className="bg-white dark:bg-gray-900">{NETWORKS.mainnet.name}</option>
        </select>
        
        <svg 
          className="w-4 h-4 text-gray-400 dark:text-gray-500 pointer-events-none -ml-1" 
          fill="none" 
          stroke="currentColor" 
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </div>
    </div>
  );
}
