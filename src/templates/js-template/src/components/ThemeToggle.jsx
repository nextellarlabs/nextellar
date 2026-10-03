'use client';

import { Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';

function applyTheme(theme) {
    document.documentElement.classList.toggle('dark', theme === 'dark');
}

/** Light/dark theme toggle for the JavaScript template. */
export default function ThemeToggle() {
    const [theme, setTheme] = useState('light');

    useEffect(() => {
        const savedTheme = localStorage.getItem('theme');
        const initialTheme = savedTheme === 'dark' || savedTheme === 'light'
            ? savedTheme
            : window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        setTheme(initialTheme);
        applyTheme(initialTheme);
    }, []);

    const toggleTheme = () => {
        const nextTheme = theme === 'dark' ? 'light' : 'dark';
        setTheme(nextTheme);
        localStorage.setItem('theme', nextTheme);
        applyTheme(nextTheme);
    };

    const isDark = theme === 'dark';
    const Icon = isDark ? Sun : Moon;

    return (
        <button
            type="button"
            onClick={toggleTheme}
            aria-label="Toggle theme"
            aria-pressed={isDark}
            title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
            className="p-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
        >
            <Icon className="w-5 h-5" aria-hidden="true" />
        </button>
    );
}