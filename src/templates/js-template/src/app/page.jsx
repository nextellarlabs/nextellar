'use client';
import Image from "next/image";
import { useState, useEffect } from 'react';
import WalletConnectButton from '../components/WalletConnectButton';
// Theme toggle hook
function useTheme() {
    const [theme, setTheme] = useState('light');
    const [mounted, setMounted] = useState(false);
    useEffect(() => {
        setMounted(true);
        const savedTheme = localStorage.getItem('theme');
        const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        const initialTheme = savedTheme || systemTheme;
        setTheme(initialTheme);
        // Force update the document class
        if (initialTheme === 'dark') {
            document.documentElement.classList.add('dark');
        }
        else {
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
        }
        else {
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
    return (<div className="h-screen relative overflow-hidden">
      {/* Background Images */}
      <div className="absolute inset-0">
        {theme === 'light' ? (<Image src="/ligt-mode-bg.svg" alt="Light mode background" fill className="object-cover" priority onError={() => console.log('Light mode background failed to load')}/>) : (<Image src="/dark-mode-bg.svg" alt="Dark mode background" fill className="object-cover" priority onError={() => console.log('Dark mode background failed to load')}/>)}
      </div>

      {/* Content */}
      <div className="relative z-10 min-h-screen flex flex-col">
        {/* Header */}
        <header className="px-6 py-6 sm:py-8">
          <div className="flex justify-between items-center max-w-7xl mx-auto w-full">
            <div className="relative w-[140px] h-[32px] sm:w-[180px] sm:h-[40px]">
              <Image src={theme === 'dark' ? "/dark-mode-logo.svg" : "/light-mode-logo.svg"} alt="Nextellar Logo" fill className="object-contain" priority/>
            </div>

            <button onClick={toggleTheme} className="p-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition-colors" aria-label="Toggle theme">
              {theme === 'dark' ? (<svg className="w-5 h-5 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clipRule="evenodd"/>
                </svg>) : (<svg className="w-5 h-5 text-gray-700" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z"/>
                </svg>)}
            </button>
          </div>
        </header>

        {/* Main Content - Centered */}
        <main className="flex-1 flex items-center justify-center px-6 py-12">
          <div className="max-w-4xl mx-auto w-full">
            {/* Steps */}
            <div className="mb-12 sm:mb-16 space-y-8 sm:space-y-6">
              <div className="flex items-start sm:items-center text-left">
                <span className={`text-xl sm:text-2xl mr-4 sm:mr-6 flex-shrink-0 font-medium ${theme === 'light' ? 'text-black' : 'text-white'}`}>1.</span>
                <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
                  <span className={`text-lg sm:text-xl md:text-2xl ${theme === 'light' ? 'text-black' : 'text-white'}`}>
                    Start with
                  </span>
                  <code className={`px-4 py-2 rounded-xl text-sm sm:text-base font-mono inline-block w-fit ${theme === 'light' ? 'bg-gray-100 text-black border border-gray-200' : 'bg-white/10 text-white border border-white/10'}`}>
                    npx nextellar my-app
                  </code>
                </div>
              </div>

              <div className="flex items-start sm:items-center text-left">
                <span className={`text-xl sm:text-2xl mr-4 sm:mr-6 flex-shrink-0 font-medium ${theme === 'light' ? 'text-black' : 'text-white'}`}>2.</span>
                <span className={`text-lg sm:text-xl md:text-2xl ${theme === 'light' ? 'text-black' : 'text-white'}`}>
                  Stellar SDK integrated - use reusable wallet components
                </span>
              </div>

              <div className="flex items-start sm:items-center text-left">
                <span className={`text-xl sm:text-2xl mr-4 sm:mr-6 flex-shrink-0 font-medium ${theme === 'light' ? 'text-black' : 'text-white'}`}>3.</span>
                <span className={`text-lg sm:text-xl md:text-2xl ${theme === 'light' ? 'text-black' : 'text-white'}`}>
                  Connect wallets, send payments, deploy to any project
                </span>
              </div>
            </div>

            {/* CTA Buttons */}
            <div className="flex flex-col sm:flex-row gap-4 items-center justify-center">
              <a href="https://developers.stellar.org/docs/build/smart-contracts/getting-started/deploy-to-testnet" target="_blank" rel="noopener noreferrer" className={`w-full sm:w-auto px-8 py-4 font-semibold rounded-full transition-all hover:scale-105 active:scale-95 flex items-center justify-center gap-2 ${theme === 'light' ? 'bg-black text-white hover:bg-gray-800 shadow-lg' : 'bg-white text-black hover:bg-gray-200 shadow-[0_0_20px_rgba(255,255,255,0.2)]'}`}>
                <Image src="/deploy.svg" alt="" width={20} height={20} className={theme === 'light' ? 'filter brightness-0 invert' : ''}/>
                Deploy to Stellar
              </a>

              <WalletConnectButton theme={theme}/>

              <a href="https://github.com/nextellarlabs/nextellar" target="_blank" rel="noopener noreferrer" className={`w-full sm:w-auto px-8 py-4 backdrop-blur-md font-semibold rounded-full border transition-all hover:scale-105 active:scale-95 flex items-center justify-center ${theme === 'light' ? 'bg-white/30 text-black border-gray-300/50 hover:bg-white/40' : 'bg-white/5 text-white border-white/10 hover:bg-white/10'}`}>
                View Docs
              </a>
            </div>
          </div>
        </main>

        {/* Footer */}
        <footer className="px-6 py-8 mt-auto">
          <div className="max-w-7xl mx-auto">
            <div className="flex flex-col items-center gap-4 text-sm sm:flex-row sm:justify-center">
              <div className="flex items-center gap-4">
                <a href="https://nextellar.dev/docs" target="_blank" rel="noopener noreferrer" className={`px-5 py-2.5 rounded-full transition-all hover:scale-105 flex items-center gap-2 font-medium ${theme === 'light' ? 'text-gray-900 bg-gray-100 hover:bg-gray-200' : 'text-white bg-white/10 hover:bg-white/20'}`}>
                  <Image src="/library.svg" alt="" width={16} height={16}/>
                  Learn
                </a>
                <a href="https://github.com/nextellarlabs/nextellar/tree/main/examples" target="_blank" rel="noopener noreferrer" className={`px-5 py-2.5 rounded-full transition-all hover:scale-105 flex items-center gap-2 font-medium ${theme === 'light' ? 'text-gray-900 bg-gray-100 hover:bg-gray-200' : 'text-white bg-white/10 hover:bg-white/20'}`}>
                  <Image src="/example.svg" alt="" width={16} height={16}/>
                  Examples
                </a>
              </div>

              <a href="https://nextellar.dev" target="_blank" rel="noopener noreferrer" className={`px-5 py-2.5 rounded-full transition-all hover:scale-105 flex items-center gap-2 font-medium ${theme === 'light' ? 'text-gray-900 bg-gray-100 hover:bg-gray-200' : 'text-white bg-white/10 hover:bg-white/20'}`}>
                <Image src="/globe.svg" alt="" width={16} height={16}/>
                Go to nextstellar.dev
              </a>
            </div>
          </div>
        </footer>
      </div>
    </div>);
}
