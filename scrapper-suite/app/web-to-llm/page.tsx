'use client';

import { useState } from 'react';
import Link from 'next/link';
import { FileText, Image, FileCode, Printer } from 'lucide-react'; // Example icons if available, using SVGs for now

export default function WebToLlmPage() {
    const [url, setUrl] = useState('');
    // Options
    const [cleanup, setCleanup] = useState<'article' | 'full'>('article');
    const [format, setFormat] = useState<'markdown' | 'html'>('markdown');
    const [includePdf, setIncludePdf] = useState(false);

    const [isLoading, setIsLoading] = useState(false);
    const [status, setStatus] = useState('');
    const [statusColor, setStatusColor] = useState('text-white/80');

    const handleProcess = async () => {
        if (!url.trim()) {
            setStatus('Please enter a URL.');
            setStatusColor('text-red-400');
            return;
        }

        setIsLoading(true);
        setStatus('Scraping and processing content...');
        setStatusColor('text-white/80');

        try {
            const response = await fetch('/api/web-to-llm', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url, format, cleanup, includePdf })
            });

            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error || 'Processing failed');
            }

            setStatus('Downloading zip...');

            const blob = await response.blob();
            const downloadUrl = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = downloadUrl;
            a.download = `llm-export-${Date.now()}.zip`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(downloadUrl);
            document.body.removeChild(a);

            setStatus('Done! Ready for LLM upload.');
            setStatusColor('text-green-400');

        } catch (error: any) {
            console.error(error);
            setStatus(`Error: ${error.message}`);
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
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                                <polyline points="14 2 14 8 20 8"></polyline>
                                <line x1="16" y1="13" x2="8" y2="13"></line>
                                <line x1="16" y1="17" x2="8" y2="17"></line>
                                <polyline points="10 9 9 9 8 9"></polyline>
                            </svg>
                        </div>
                        <h1 className="text-3xl font-bold">Web to LLM</h1>
                    </div>
                    <p className="text-white/60">Convert websites into AI-ready Markdown with local images.</p>
                    <Link href="/" className="inline-block mt-4 text-white/50 hover:text-white transition-colors">
                        ← Back to Dashboard
                    </Link>
                </header>

                <main className="flex flex-col gap-6 text-left">
                    {/* URL Input */}
                    <div className="space-y-2">
                        <label className="text-sm text-white/60 ml-1">Target URL</label>
                        <input
                            type="text"
                            value={url}
                            onChange={(e) => setUrl(e.target.value)}
                            placeholder="https://example.com/blog-post"
                            className="w-full p-4 bg-white/10 border border-white/10 rounded-xl text-white placeholder-white/40 focus:outline-none focus:border-white/30 transition-all"
                            disabled={isLoading}
                        />
                    </div>

                    {/* Options Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Cleanup Mode */}
                        <div className="bg-white/5 p-4 rounded-xl border border-white/5">
                            <label className="text-sm text-white/60 block mb-3">Cleanup Mode</label>
                            <div className="flex bg-black/20 p-1 rounded-lg">
                                <button
                                    onClick={() => setCleanup('article')}
                                    className={`flex-1 py-1.5 px-3 rounded text-xs font-medium transition-all ${cleanup === 'article' ? 'bg-white/20 text-white' : 'text-white/40 hover:text-white/60'}`}
                                >
                                    Article Only
                                </button>
                                <button
                                    onClick={() => setCleanup('full')}
                                    className={`flex-1 py-1.5 px-3 rounded text-xs font-medium transition-all ${cleanup === 'full' ? 'bg-white/20 text-white' : 'text-white/40 hover:text-white/60'}`}
                                >
                                    Full Page
                                </button>
                            </div>
                            <p className="text-[10px] text-white/30 mt-2">
                                {cleanup === 'article' ? 'Removes ads, navs, and sidebars (Best for LLMs).' : 'Keeps everything (Good for landing pages).'}
                            </p>
                        </div>

                        {/* Format */}
                        <div className="bg-white/5 p-4 rounded-xl border border-white/5">
                            <label className="text-sm text-white/60 block mb-3">Output Format</label>
                            <div className="flex bg-black/20 p-1 rounded-lg">
                                <button
                                    onClick={() => setFormat('markdown')}
                                    className={`flex-1 py-1.5 px-3 rounded text-xs font-medium transition-all ${format === 'markdown' ? 'bg-white/20 text-white' : 'text-white/40 hover:text-white/60'}`}
                                >
                                    Markdown
                                </button>
                                <button
                                    onClick={() => setFormat('html')}
                                    className={`flex-1 py-1.5 px-3 rounded text-xs font-medium transition-all ${format === 'html' ? 'bg-white/20 text-white' : 'text-white/40 hover:text-white/60'}`}
                                >
                                    HTML
                                </button>
                            </div>
                            <p className="text-[10px] text-white/30 mt-2">
                                Markdown is recommended for ChatGPT/Claude.
                            </p>
                        </div>
                    </div>

                    {/* Checkbox */}
                    <div className="flex items-center gap-3 ml-1">
                        <input
                            type="checkbox"
                            id="pdf-check"
                            checked={includePdf}
                            onChange={(e) => setIncludePdf(e.target.checked)}
                            className="w-4 h-4 rounded border-white/20 bg-white/10 text-pink-500 focus:ring-pink-500"
                        />
                        <label htmlFor="pdf-check" className="text-sm text-white/80 cursor-pointer select-none">
                            Include <b>PDF Snapshot</b> in download
                        </label>
                    </div>

                    <button
                        onClick={handleProcess}
                        disabled={isLoading}
                        className="w-full p-4 bg-white hover:bg-white/90 text-black font-semibold rounded-xl transition-all disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center relative shadow-lg shadow-white/10 mt-2"
                    >
                        <span className={isLoading ? 'invisible' : ''}>
                            Convert & Download ZIP
                        </span>
                        {isLoading && <span className="loader border-black absolute border-t-transparent"></span>}
                    </button>

                    <div className={`h-6 text-sm text-center ${statusColor}`}>
                        {status}
                    </div>
                </main>
            </div>
        </div>
    );
}
