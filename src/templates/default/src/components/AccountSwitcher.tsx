'use client';

import { useState, useRef, useEffect } from 'react';
import { useWallet } from '../contexts';

/**
 * Account Switcher Component
 * 
 * Displays a dropdown menu of available accounts that have been connected
 * and allows switching between them. Shows the current active account with
 * a checkmark indicator.
 */
export default function AccountSwitcher() {
  const { connected, accounts, currentAccountIndex, switchAccount, publicKey } = useWallet();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  if (!connected || accounts.length === 0) {
    return null;
  }

  const currentAccount = accounts[currentAccountIndex];

  const handleAccountChange = async (address: string) => {
    if (address !== publicKey) {
      await switchAccount(address);
    }
    setIsOpen(false);
  };

  return (
    <div ref={dropdownRef} className="relative inline-block">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="px-4 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 transition-colors text-sm font-medium text-gray-900 dark:text-white"
        title={currentAccount?.address}
        aria-haspopup="true"
        aria-expanded={isOpen}
        aria-controls="account-switcher-menu"
      >
        <span className="flex items-center gap-2">
          {currentAccount?.displayName || currentAccount?.address}
          <svg
            className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
        </span>
      </button>

      {isOpen && (
        <div
          id="account-switcher-menu"
          role="menu"
          className="absolute top-full left-0 mt-2 w-64 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-50"
        >
          <div className="p-2">
            <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 px-3 py-2">
              Available Accounts ({accounts.length})
            </div>
            {accounts.map((account, index) => {
              const isCurrent = account.address === publicKey;
              return (
                <button
                  key={account.address}
                  onClick={() => handleAccountChange(account.address)}
                  role="menuitem"
                  aria-current={isCurrent ? 'true' : undefined}
                  className={`w-full text-left px-3 py-2 rounded-md transition-colors flex items-center gap-2 ${
                    isCurrent
                      ? 'bg-blue-100 dark:bg-blue-900 text-blue-900 dark:text-blue-100'
                      : 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-900 dark:text-gray-100'
                  }`}
                >
                  <span className="flex-1">
                    <div className="font-medium">{account.displayName || account.address}</div>
                    {account.displayName && (
                      <div className="text-xs text-gray-500 dark:text-gray-400">{account.address}</div>
                    )}
                  </span>
                  {isCurrent && (
                    <svg
                      className="w-4 h-4 text-blue-600 dark:text-blue-400"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                      aria-hidden="true"
                    >
                      <path
                        fillRule="evenodd"
                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
