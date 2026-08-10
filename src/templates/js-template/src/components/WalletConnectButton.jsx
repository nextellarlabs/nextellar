'use client';
import { useState, useEffect } from 'react';
import { useWallet } from '../contexts';
// Simple inline SVG icons
const WalletIcon = () => (<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"/>
  </svg>);
const LoaderIcon = () => (<svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
    <path className="opacity-75" fill="currentColor" d="m4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
  </svg>);
/**
 * Simple Wallet Connect Button - Matches the "Deploy to Stellar" button style
 *
 * A clean, reusable button component that integrates with Stellar wallets.
 * Follows the same design system as the main CTA buttons.
 */
export default function WalletConnectButton({ theme = 'light' }) {
    const { connected, connect, disconnect, walletName } = useWallet();
    const [isLoading, setIsLoading] = useState(false);
    // Custom modal content replacer
    useEffect(() => {
        const replaceModalContent = () => {
            // Look for modal elements and replace content
            const modalElements = document.querySelectorAll('[class*="swk"], [class*="modal"]');
            modalElements.forEach(modal => {
                // Find and hide elements containing the unwanted text
                const walker = document.createTreeWalker(modal, NodeFilter.SHOW_TEXT);
                const textNodes = [];
                let node;
                while (node = walker.nextNode()) {
                    textNodes.push(node);
                }
                textNodes.forEach(textNode => {
                    const text = textNode.textContent || '';
                    if (text.includes('Learn more') ||
                        text.includes('What is a Wallet') ||
                        text.includes('What is Stellar') ||
                        text.includes('Wallets are used to send') ||
                        text.includes('Stellar is a decentralized')) {
                        const parent = textNode.parentElement;
                        if (parent) {
                            parent.style.display = 'none';
                        }
                    }
                });
                // Add our custom message if not already added
                if (!modal.querySelector('.custom-stellar-message')) {
                    const customMessage = document.createElement('div');
                    customMessage.className = 'custom-stellar-message';
                    customMessage.innerHTML = `
            <div style="
              padding: 16px;
              margin: 16px 0;
              background: var(--background, #fff);
              color: var(--foreground, #000);
              border-radius: 8px;
              font-size: 14px;
              line-height: 1.5;
              border: 1px solid rgba(156, 163, 175, 0.3);
            ">
              ✨ The Stellar SDK has been integrated into this template. Use the reusable Connect Wallet button component in any project to connect to Freighter, Albedo, Lobstr, and other popular Stellar wallets.
            </div>
          `;
                    modal.appendChild(customMessage);
                }
            });
        };
        // Run immediately and also observe for new modals
        const observer = new MutationObserver(() => {
            setTimeout(replaceModalContent, 100);
        });
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
        // Cleanup
        return () => {
            observer.disconnect();
        };
    }, []);
    const handleClick = async () => {
        setIsLoading(true);
        try {
            if (connected) {
                await disconnect();
            }
            else {
                await connect();
            }
        }
        catch (error) {
            console.error('Wallet operation failed:', error);
        }
        finally {
            setIsLoading(false);
        }
    };
    const getButtonText = () => {
        if (isLoading)
            return connected ? 'Disconnecting...' : 'Connecting...';
        if (connected)
            return `Disconnect ${walletName}`;
        return 'Connect Wallet';
    };
    const getIcon = () => {
        if (isLoading)
            return <LoaderIcon />;
        return <WalletIcon />;
    };
    return (<button onClick={handleClick} disabled={isLoading} className={`px-8 py-3 font-medium rounded-full transition-colors ${theme === 'light'
            ? 'bg-black text-white hover:bg-gray-800'
            : 'bg-white text-black hover:bg-gray-200'} ${isLoading ? 'opacity-75 cursor-not-allowed' : ''}`}>
      <span className="flex items-center gap-2">
        {getIcon()}
        {getButtonText()}
      </span>
    </button>);
}
