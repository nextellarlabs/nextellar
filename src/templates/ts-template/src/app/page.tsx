'use client';

import Image from "next/image";
import { useState, useEffect } from 'react';
import WalletConnectButton from '../components/WalletConnectButton';

// Theme toggle hook
function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const savedTheme = localStorage.getItem('theme') as 'light' | 'dark' | null;
    const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    const initialTheme = savedTheme || systemTheme;
    
    setTheme(initialTheme);
    
    // Force update the document class
    if (initialTheme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    
    console.log('Theme initialized:', initialTheme);
  }, []);

  const toggleTheme = () => {
    const newTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
    localStorage.setItem('theme', newTheme);
    
    // Force update the document class
    if (newTheme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    
    console.log('Theme switched to:', newTheme);
  };

  return { theme, toggleTheme, mounted };
}

export default function Home() {
  const { theme, toggleTheme, mounted } = useTheme();

  if (!mounted) {
    return null;
  }

  console.log('Current theme:', theme, 'Document classes:', document.documentElement.className);

  return (
    <div className="h-screen relative overflow-hidden">
      {/* Background Images */}
      <div className="absolute inset-0">
        {theme === 'light' ? (
          <Image
            src="/ligt-mode-bg.svg"
            alt="Light mode background"
            fill
            className="object-cover"
            priority
            onError={() => console.log('Light mode background failed to load')}
          />
        ) : (
          <Image
            src="/dark-mode-bg.svg"
            alt="Dark mode background"
            fill
            className="object-cover"
            priority
            onError={() => console.log('Dark mode background failed to load')}
          />
        )}
      </div>

      {/* Content */}
      <div className="relative z-10 h-full flex flex-col">
        {/* Header */}
        <header className="px-6 py-8">
          <div className="flex justify-between items-center">
            <Image
              src={theme === 'dark' ? "/dark-mode-logo.svg" : "/light-mode-logo.svg"}
              alt="Nextellar Logo"
              width={180}
              height={40}
              priority
            />
            
            <button
              onClick={toggleTheme}
              className="p-2 rounded-lg hover:bg-white/10 dark:hover:bg-black/20 transition-colors"
              aria-label="Toggle theme"
            >
              {theme === 'dark' ? (
                <svg className="w-5 h-5 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clipRule="evenodd" />
                </svg>
              ) : (
                <svg className="w-5 h-5 text-gray-700" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
                </svg>
              )}
            </button>
          </div>
        </header>

        {/* Main Content - Centered */}
        <main className="flex-1 flex items-center justify-center px-6">
          <div className="max-w-4xl mx-auto text-center">
            {/* Steps */}
            <div className="mb-16 space-y-6 px-4 sm:px-0">
              <div className="flex items-center text-left">
                <span className={`lg:text-xl sm:text-lg mr-4 sm:mr-6 flex-shrink-0 ${theme === 'light' ? 'text-black' : 'text-white'}`}>1.</span>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`text-base sm:text-lg md:text-xl text-wrap ${theme === 'light' ? 'text-black' : 'text-white'}`}>
                    Start with &nbsp;
                  
                  <code className={`px-3 py-2 rounded-lg text-sm sm:text-base  ${theme === 'light' ? 'bg-gray-200 text-black' : 'bg-gray-700 text-white'}`}>
                    npx nextellar my-app
                  </code>
                  </span>
                </div>
              </div>
              
              <div className="flex items-center text-left">
                <span className={`lg:text-xl sm:text-lg mr-4 sm:mr-6 flex-shrink-0 ${theme === 'light' ? 'text-black' : 'text-white'}`}>2.</span>
                <span className={`text-base sm:text-lg md:text-xl ${theme === 'light' ? 'text-black' : 'text-white'}`}>
                  Stellar SDK integrated - use reusable wallet components
                </span>
              </div>
              
              <div className="flex items-center text-left">
                <span className={`lg:text-xl sm:text-lg mr-4 sm:mr-6 flex-shrink-0 ${theme === 'light' ? 'text-black' : 'text-white'}`}>3.</span>
                <span className={`text-base sm:text-lg md:text-xl ${theme === 'light' ? 'text-black' : 'text-white'}`}>
                  Connect wallets, send payments, deploy to any project
                </span>
              </div>
            </div>

            {/* CTA Buttons */}
            <div className="flex flex-col sm:flex-row gap-4 items-center justify-center mb-16">
              <button className={`px-8 py-3 font-medium rounded-full transition-colors ${theme === 'light' ? 'bg-black text-white hover:bg-gray-800' : 'bg-white text-black hover:bg-gray-200'}`}>
                <span className="flex items-center gap-2">
                  <Image 
                    src="/deploy.svg" 
                    alt="" 
                    width={20} 
                    height={20} 
                    className={theme === 'light' ? 'filter brightness-0 invert' : ''}
                  />
                  Deploy to Stellar
                </span>
              </button>
              
              <WalletConnectButton theme={theme} />
              
              <button className={`px-8 py-3 backdrop-blur-sm font-medium rounded-full border transition-colors ${theme === 'light' ? 'bg-white/10 text-black border-gray-300/50 hover:bg-white/20' : 'bg-black/10 text-white border-gray-600/50 hover:bg-black/20'}`}>
                View Docs
              </button>
            </div>
          </div>
        </main>

        {/* Footer */}
        <footer className="px-6 py-8">
          <div className="max-w-4xl mx-auto">
            <div className="flex flex-col items-center gap-4 text-sm sm:flex-row sm:justify-center">
              {/* First Row - Learn and Examples on mobile, all buttons on desktop */}
              <div className="flex justify-center items-center gap-4 sm:contents">
                <a
                  href="#"
                  className={`px-4 py-2 rounded-full transition-colors flex items-center gap-2 ${theme === 'light' ? 'text-black' : 'text-white'}`}
                  style={{ backgroundColor: theme === 'light' ? '#E6E6E6' : '#2D2D2D' }}
                >
                  <Image src="/library.svg" alt="" width={16} height={16} />
                  Learn
                </a>
                <a
                  href="#"
                  className={`px-4 py-2 rounded-full transition-colors flex items-center gap-2 ${theme === 'light' ? 'text-black' : 'text-white'}`}
                  style={{ backgroundColor: theme === 'light' ? '#E6E6E6' : '#2D2D2D' }}
                >
                  <Image src="/example.svg" alt="" width={16} height={16} />
                  Examples
                </a>
              </div>
              
              {/* Second Row - Go to nextstellar.dev centered on mobile, inline on desktop */}
              <a
                href="#"
                className={`px-4 py-2 rounded-full transition-colors flex items-center gap-2 ${theme === 'light' ? 'text-black' : 'text-white'}`}
                style={{ backgroundColor: theme === 'light' ? '#E6E6E6' : '#2D2D2D' }}
              >
                <Image src="/globe.svg" alt="" width={16} height={16} />
                Go to nextstellar.dev
              </a>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}