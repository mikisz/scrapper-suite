import Link from 'next/link';

export default function WebToPngPage() {
    return (
        <div className="min-h-screen flex flex-col items-center justify-center p-8">
            <div className="max-w-lg w-full glass-panel p-8 text-center">
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
                    <p className="text-white/60">Convert any website into a high-quality PNG image.</p>
                    <Link href="/" className="inline-block mt-4 text-white/50 hover:text-white transition-colors">
                        ← Back to Dashboard
                    </Link>
                </header>

                <main className="flex flex-col gap-4">
                    <input
                        type="text"
                        placeholder="https://example.com"
                        className="w-full p-4 bg-white/10 border border-white/10 rounded-xl text-white placeholder-white/40 focus:outline-none cursor-not-allowed opacity-50"
                        disabled
                    />
                    <button
                        disabled
                        className="w-full p-4 bg-white/5 text-white/50 font-semibold rounded-xl cursor-not-allowed border border-white/10"
                    >
                        Coming Soon
                    </button>
                </main>
            </div>
        </div>
    );
}
