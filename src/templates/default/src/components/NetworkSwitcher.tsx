"use client";

import React, { useState, useEffect, useRef } from "react";
import { useWalletConfig, useWallet } from "../contexts/WalletProvider";
import { NETWORKS } from "../config/networks";

const ADD_CUSTOM_NETWORK_VALUE = "__add_custom_network__";

/**
 * Keys that move the highlighted option of a closed <select>. Browsers commit
 * a `change` on every one of these presses (Windows/Chrome), which would
 * switch networks - and prompt to disconnect the wallet - once per keystroke
 * while a keyboard user is only browsing the list. They are handled here
 * instead, so arrowing only previews an option and Enter commits it.
 */
const NAVIGATION_KEYS = new Set(["ArrowDown", "ArrowUp", "Home", "End"]);

export default function NetworkSwitcher() {
  const [mounted, setMounted] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [formKey, setFormKey] = useState("");
  const [formName, setFormName] = useState("");
  const [formHorizonUrl, setFormHorizonUrl] = useState("");
  const [formSorobanUrl, setFormSorobanUrl] = useState("");
  const [formPassphrase, setFormPassphrase] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const config = useWalletConfig();
  const wallet = useWallet();
  const labelId = "stellar-network-switcher-label";
  const hintId = "stellar-network-switcher-hint";
  // Option highlighted by keyboard navigation but not yet committed.
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  // Set while a keydown is being handled, so the browser's own `change`
  // (e.g. type-ahead) is treated as navigation rather than a commit.
  const keyboardNavigating = useRef(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || !config || !config.switchNetwork) {
    return null;
  }

  const { activeNetworkKey, switchNetwork, networks, addCustomNetwork } =
    config;
  // Older WalletProvider versions predating issue #1107 don't expose
  // networks/addCustomNetwork — fall back to the built-in presets and hide
  // the "add network" entry rather than crashing.
  const availableNetworks = networks ?? NETWORKS;

  const resetForm = () => {
    setFormKey("");
    setFormName("");
    setFormHorizonUrl("");
    setFormSorobanUrl("");
    setFormPassphrase("");
    setFormError(null);
  };

  const optionKeys = [
    ...Object.keys(availableNetworks),
    ...(addCustomNetwork ? [ADD_CUSTOM_NETWORK_VALUE] : []),
  ];
  const displayedKey = pendingKey ?? activeNetworkKey;

  /** Commit a network choice (pointer selection, Enter, or blur). */
  const selectNetwork = (newNetwork: string) => {
    setPendingKey(null);
    if (newNetwork === ADD_CUSTOM_NETWORK_VALUE) {
      resetForm();
      setShowAddForm(true);
      return;
    }
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

  const handleNetworkChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (keyboardNavigating.current) {
      // Keyboard browsing (type-ahead): preview only, Enter commits.
      setPendingKey(e.target.value);
      return;
    }
    selectNetwork(e.target.value);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLSelectElement>) => {
    // Alt/Meta + arrow opens the native popup; leave that to the browser.
    if (e.altKey || e.metaKey) return;

    if (NAVIGATION_KEYS.has(e.key)) {
      e.preventDefault();
      if (optionKeys.length === 0) return;
      const current = Math.max(optionKeys.indexOf(displayedKey), 0);
      const last = optionKeys.length - 1;
      const next =
        e.key === "Home"
          ? 0
          : e.key === "End"
            ? last
            : e.key === "ArrowDown"
              ? Math.min(current + 1, last)
              : Math.max(current - 1, 0);
      setPendingKey(optionKeys[next] === activeNetworkKey ? null : optionKeys[next]);
      return;
    }

    if (e.key === "Enter") {
      if (pendingKey !== null) {
        e.preventDefault();
        selectNetwork(pendingKey);
      }
      return;
    }

    if (e.key === "Escape") {
      if (pendingKey !== null) {
        e.preventDefault();
        setPendingKey(null);
      }
      return;
    }

    if (e.key.length === 1) {
      // Printable key: the browser's type-ahead may fire `change` next.
      keyboardNavigating.current = true;
      setTimeout(() => {
        keyboardNavigating.current = false;
      }, 0);
    }
  };

  /** Leaving the control keeps a previewed choice, like a native select. */
  const handleBlur = () => {
    if (pendingKey !== null) {
      selectNetwork(pendingKey);
    }
  };

  const handleAddNetworkSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!addCustomNetwork) return;

    try {
      addCustomNetwork(formKey.trim(), {
        name: formName.trim() || formKey.trim(),
        horizonUrl: formHorizonUrl.trim(),
        sorobanUrl: formSorobanUrl.trim(),
        passphrase: formPassphrase.trim(),
      });
      const addedKey = formKey.trim();
      setShowAddForm(false);
      resetForm();
      switchNetwork(addedKey);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    }
  };

  const isTestnet = activeNetworkKey === "testnet";

  if (showAddForm) {
    return (
      <form
        onSubmit={handleAddNetworkSubmit}
        aria-label="Add custom network"
        className="flex flex-col gap-2 bg-white/5 dark:bg-black/20 backdrop-blur-md rounded-2xl p-4 border border-gray-200/50 dark:border-white/10 shadow-sm w-full max-w-sm"
      >
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            Add custom network
          </span>
          <button
            type="button"
            onClick={() => {
              setShowAddForm(false);
              resetForm();
            }}
            aria-label="Cancel adding custom network"
            className="text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 text-sm"
          >
            &times;
          </button>
        </div>

        {formError && (
          <p role="alert" className="text-xs text-red-600 dark:text-red-400">
            {formError}
          </p>
        )}

        <label className="text-xs text-gray-600 dark:text-gray-300">
          Network key
          <input
            type="text"
            required
            value={formKey}
            onChange={(e) => setFormKey(e.target.value)}
            placeholder="e.g. futurenet"
            className="mt-1 w-full rounded-md border border-gray-300 dark:border-white/10 bg-transparent px-2 py-1 text-sm text-gray-900 dark:text-gray-100"
          />
        </label>

        <label className="text-xs text-gray-600 dark:text-gray-300">
          Display name
          <input
            type="text"
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
            placeholder="e.g. Futurenet"
            className="mt-1 w-full rounded-md border border-gray-300 dark:border-white/10 bg-transparent px-2 py-1 text-sm text-gray-900 dark:text-gray-100"
          />
        </label>

        <label className="text-xs text-gray-600 dark:text-gray-300">
          Horizon URL
          <input
            type="text"
            required
            value={formHorizonUrl}
            onChange={(e) => setFormHorizonUrl(e.target.value)}
            placeholder="https://horizon-futurenet.stellar.org"
            className="mt-1 w-full rounded-md border border-gray-300 dark:border-white/10 bg-transparent px-2 py-1 text-sm text-gray-900 dark:text-gray-100"
          />
        </label>

        <label className="text-xs text-gray-600 dark:text-gray-300">
          Soroban RPC URL
          <input
            type="text"
            required
            value={formSorobanUrl}
            onChange={(e) => setFormSorobanUrl(e.target.value)}
            placeholder="https://rpc-futurenet.stellar.org"
            className="mt-1 w-full rounded-md border border-gray-300 dark:border-white/10 bg-transparent px-2 py-1 text-sm text-gray-900 dark:text-gray-100"
          />
        </label>

        <label className="text-xs text-gray-600 dark:text-gray-300">
          Network passphrase
          <input
            type="text"
            required
            value={formPassphrase}
            onChange={(e) => setFormPassphrase(e.target.value)}
            placeholder="Test SDF Future Network ; October 2022"
            className="mt-1 w-full rounded-md border border-gray-300 dark:border-white/10 bg-transparent px-2 py-1 text-sm text-gray-900 dark:text-gray-100"
          />
        </label>

        <button
          type="submit"
          className="mt-2 w-full rounded-md bg-gray-900 dark:bg-white text-white dark:text-gray-900 text-sm font-semibold py-1.5"
        >
          Add network
        </button>
      </form>
    );
  }

  return (
    <div className="relative group">
      <div className="flex items-center gap-3 bg-white/5 dark:bg-black/20 backdrop-blur-md rounded-full px-4 py-2 border border-gray-200/50 dark:border-white/10 hover:border-gray-300 dark:hover:border-white/20 transition-all shadow-sm">
        <div className="flex items-center gap-2">
          <div className="relative">
            <div
              className={`w-2.5 h-2.5 rounded-full ${
                isTestnet ? "bg-green-700" : "bg-orange-700"
              }`}
            />
            <div
              className={`absolute inset-0 w-2.5 h-2.5 rounded-full animate-ping opacity-75 ${
                isTestnet ? "bg-green-600" : "bg-orange-600"
              }`}
            />
          </div>
          <span
            id={labelId}
            className="sr-only text-xs font-bold uppercase tracking-wider text-gray-700 dark:text-gray-300 sm:not-sr-only"
          >
            Network
          </span>
        </div>

        <div className="h-4 w-[1px] bg-gray-200 dark:bg-white/10" />

        <select
          value={displayedKey}
          onChange={handleNetworkChange}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          aria-labelledby={labelId}
          aria-describedby={hintId}
          className="bg-transparent border-none text-sm font-semibold focus:ring-0 cursor-pointer text-gray-900 dark:text-gray-100 outline-none pr-2 appearance-none"
        >
          {Object.entries(availableNetworks).map(([key, network]) => (
            <option key={key} value={key} className="bg-white dark:bg-gray-900">
              {network.name}
            </option>
          ))}
          {addCustomNetwork && (
            <option value={ADD_CUSTOM_NETWORK_VALUE} className="bg-white dark:bg-gray-900">
              + Add custom network...
            </option>
          )}
        </select>

        <svg
          className="w-4 h-4 text-gray-600 dark:text-gray-300 pointer-events-none -ml-1"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
        <span id={hintId} className="sr-only">
          Use the arrow keys to choose a network, Enter to switch, Escape to cancel.
        </span>
      </div>
    </div>
  );
}
