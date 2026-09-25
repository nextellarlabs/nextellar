'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Shared clipboard-copy hook with timed copied feedback state.
 */
export function useClipboard({ resetDelayMs = 2000 } = {}) {
    const [copied, setCopied] = useState(false);
    const [error, setError] = useState(null);
    const timeoutRef = useRef(null);

    useEffect(() => () => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
    }, []);

    const copy = useCallback(async (text) => {
        if (!text) return false;

        if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
            setError(new Error('Clipboard API is not available in this environment.'));
            setCopied(false);
            return false;
        }

        try {
            await navigator.clipboard.writeText(text);
            setError(null);
            setCopied(true);
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
            timeoutRef.current = setTimeout(() => setCopied(false), resetDelayMs);
            return true;
        } catch (caughtError) {
            setCopied(false);
            setError(caughtError instanceof Error ? caughtError : new Error('Failed to copy to clipboard.'));
            return false;
        }
    }, [resetDelayMs]);

    return { copied, error, copy };
}