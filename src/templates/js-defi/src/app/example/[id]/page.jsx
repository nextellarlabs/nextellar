'use client';
import { use } from 'react';
import Link from 'next/link';
/**
 * Nextellar Dynamic Route Example
 *
 * Demonstrates how to handle dynamic route parameters in Next.js 15.
 * In Next.js 15, 'params' and 'searchParams' are Promises and must be unwrapped using 'use()'.
 */
export default function ExampleDetailsPage({ params }) {
    const { id } = use(params);
    return (<div className="min-h-screen p-8 font-sans">
            <main className="max-w-2xl mx-auto space-y-8">
                <div className="space-y-4">
                    <Link href="/" className="text-blue-500 hover:underline">← Back to Home</Link>
                    <h1 className="text-4xl font-bold tracking-tight">Dynamic Item: {id}</h1>
                    <p className="text-gray-500 leading-relaxed">
                        This page was generated dynamically using the parameter from the URL.
                        In Nextellar (Next.js 15), we correctly unwrap the <code>params</code> Promise.
                    </p>
                </div>

                <div className="p-6 bg-gray-50 border border-gray-200 rounded-xl space-y-4 text-sm">
                    <h2 className="font-bold">Pro Tip for DX</h2>
                    <p>
                        Always ensure your dynamic route components are <code>'use client'</code> if using React Hooks,
                        or handle the Promise correctly in Server Components.
                    </p>
                </div>
            </main>
        </div>);
}
