'use client'; // Must be a client component for error boundaries

import { useEffect } from 'react';

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function ErrorBoundary({ error, reset }: ErrorProps) {
  useEffect(() => {
    // Log the error securely to console or a reporting service
    console.error('Captured UI crash:', error);
  }, [error]);

  return (
    <div className="min-h-screen bg-[#0a0a0a] relative flex flex-col items-center justify-center text-white px-4">
      {/* Decorative Subtle Grid or Radial Background Layer */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:24px_24px] pointer-events-none" />

      {/* Main Error Container */}
      <div className="relative z-10 max-w-md w-full text-center space-y-6">
        
        {/* Error Indicator/Banner */}
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-mono tracking-wider uppercase">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
          System Error
        </div>

        {/* Heading */}
        <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-b from-white to-zinc-400 bg-clip-text text-transparent">
          An Unexpected Error Occurred
        </h1>

        {/* Dynamic Safe Description */}
        <p className="text-sm text-zinc-400 leading-relaxed font-mono bg-zinc-900/50 p-4 rounded-lg border border-zinc-800 max-h-32 overflow-y-auto break-words text-left">
          {error.message || "The view failed to render correctly. This could be due to a missing asset, connection timeout, or runtime compilation error."}
        </p>

        {/* Action Button Controls */}
        <div className="pt-2">
          <button
            onClick={() => reset()}
            className="w-full sm:w-auto px-6 py-2.5 bg-white/80 text-black font-medium text-sm rounded-lg hover:bg-zinc-200 transition-colors duration-200 shadow-lg shadow-white/5 active:scale-[0.98]"
          >
            Try Again 
          </button>
        </div>
      </div>
    </div>
  );
}
