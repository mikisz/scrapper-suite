'use client';

import { useState } from 'react';
import Link from 'next/link';

export default function WebToPngPage() {
    const [mode, setMode] = useState<'recursive' | 'bulk'>('recursive');
    const [url, setUrl] = useState('');
    const [bulkUrls, setBulkUrls] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [status, setStatus] = useState('');
    const [statusColor, setStatusColor] = useState('text-white/80');

    const handleDownload = async () => {
        const payload: { mode: string; url?: string; urls?: string[] } = { mode };

        if (mode === 'recursive') {
            if (!url.trim()) {
                setStatus('Please enter a starting URL.');
                setStatusColor('text-red-400');
                return;
            }
            // Basic validation
            try { new URL(url); } catch {
                setStatus('Please enter a valid URL (include http:// or https://)');
                setStatusColor('text-red-400');
                return;
            }
            payload.url = url;
        } else {
            const urls = bulkUrls.split('\n').map(u => u.trim()).filter(u => u);
            if (urls.length === 0) {
                setStatus('Please enter at least one URL.');
                setStatusColor('text-red-400');
                return;
            }
            payload.urls = urls;
        }

        setIsLoading(true);
        setStatus('Starting scraper... This might take a while depending on page count.');
        setStatusColor('text-white/80');

        try {
            const response = await fetch('/api/web-to-png', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error || 'Scraping failed');
            }

            setStatus('Processing done. Downloading zip...');

            // Handle file download
            const blob = await response.blob();
            const downloadUrl = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = downloadUrl;
            a.download = `screenshots-${Date.now()}.zip`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(downloadUrl);
            document.body.removeChild(a);

            setStatus('Done! Check your downloads.');
            setStatusColor('text-green-400');

        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error(error);
            setStatus(`Error: ${message}`);
            setStatusColor('text-red-400');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex flex-col items-center justify-center p-8">
            <div className="max-w-2xl w-full glass-panel p-8 text-center">
                <header className="mb-8">
                    <div className="flex flex-col items-center gap-4 mb-4">
                        <div className="w-16 h-16 bg-white/10 rounded-full flex items-center justify-center">
                            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                                <circle cx="8.5" cy="8.5" r="1.5"></circle>
                                <polyline points="21 15 16 10 5 21"></polyline>
                            </svg>
                        </div>
                        <h1 className="text-3xl font-bold">Website to PNG</h1>
                    </div>
                    <p className="text-white/60">Convert websites into high-quality PNG images.</p>
                    <Link href="/" className="inline-block mt-4 text-white/50 hover:text-white transition-colors">
                        ← Back to Dashboard
                    </Link>
                </header>

                <main className="flex flex-col gap-6">
                    {/* Tabs */}
                    <div className="flex bg-white/5 p-1 rounded-xl">
                        <button
                            onClick={() => setMode('recursive')}
                            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${mode === 'recursive' ? 'bg-white/10 text-white shadow-sm' : 'text-white/40 hover:text-white/60'}`}
                        >
                            Recursive Scan
                        </button>
                        <button
                            onClick={() => setMode('bulk')}
                            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${mode === 'bulk' ? 'bg-white/10 text-white shadow-sm' : 'text-white/40 hover:text-white/60'}`}
                        >
                            Bulk List
                        </button>
                    </div>

                    {/* Content */}
                    <div className="min-h-[200px] flex flex-col justify-center">
                        {mode === 'recursive' ? (
                            <div className="space-y-2 text-left">
                                <label className="text-sm text-white/60 ml-1">Starting URL</label>
                                <input
                                    type="text"
                                    value={url}
                                    onChange={(e) => setUrl(e.target.value)}
                                    placeholder="https://example.com"
                                    className="w-full p-4 bg-white/10 border border-white/10 rounded-xl text-white placeholder-white/40 focus:outline-none focus:border-white/30 transition-all"
                                    disabled={isLoading}
                                />
                                <p className="text-xs text-white/40 ml-1">
                                    * Will crawl up to 20 internal subpages automatically.
                                </p>
                            </div>
                        ) : (
                            <div className="space-y-2 text-left">
                                <label className="text-sm text-white/60 ml-1">URL List (One per line)</label>
                                <textarea
                                    value={bulkUrls}
                                    onChange={(e) => setBulkUrls(e.target.value)}
                                    placeholder="https://example.com/page1&#10;https://example.com/page2"
                                    className="w-full p-4 h-48 bg-white/10 border border-white/10 rounded-xl text-white placeholder-white/40 focus:outline-none focus:border-white/30 transition-all resize-none font-mono text-sm"
                                    disabled={isLoading}
                                />
                            </div>
                        )}
                    </div>

                    <button
                        onClick={handleDownload}
                        disabled={isLoading}
                        className="w-full p-4 bg-white hover:bg-white/90 text-black font-semibold rounded-xl transition-all disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center relative shadow-lg shadow-white/10"
                    >
                        <span className={isLoading ? 'invisible' : ''}>
                            {mode === 'recursive' ? 'Scan & Download' : 'Process Bulk List'}
                        </span>
                        {isLoading && <span className="loader border-black absolute border-t-transparent"></span>}
                    </button>

                    <div className={`h-6 text-sm ${statusColor}`}>
                        {status}
                    </div>
                </main>
            </div>
        </div>
    );
}
