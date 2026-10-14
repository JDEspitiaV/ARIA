import React, { useState } from 'react';
import { ShieldCheck, AlertTriangle, Cpu, Globe } from 'lucide-react';
import { signInWithSSO, initializeUserRecord } from '../lib/firebase';

interface AuthModalProps {
  onAuthenticated: (userId: string) => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ onAuthenticated }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSSO = async (provider: 'google' | 'microsoft' | 'apple') => {
    setLoading(true);
    setError(null);
    try {
      const user = await signInWithSSO(provider);
      if (user) {
        await initializeUserRecord(user);
        onAuthenticated(user.uid);
      }
    } catch (err: any) {
      setError(err.message || 'Authentication failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-2xl p-6 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
        
        <div className="flex items-center gap-3 mb-6 border-b border-zinc-800 pb-4">
          <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-400">
            <Cpu className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white tracking-wider">STRIDES AUTHENTICATION</h2>
            <p className="text-xs text-zinc-400">Tactical Race Insight & Data Extraction</p>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-xl flex items-start gap-2.5 text-xs text-red-400">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="leading-relaxed">{error}</div>
          </div>
        )}

        <div className="space-y-3">
          <button
            type="button"
            onClick={() => handleSSO('google')}
            disabled={loading}
            className="w-full py-3.5 px-4 bg-zinc-800 hover:bg-zinc-750 text-white rounded-xl border border-zinc-700 flex items-center justify-center gap-3 font-medium text-sm transition-all shadow-md hover:border-emerald-500/50 disabled:opacity-50 cursor-pointer"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
            </svg>
            <span>Continue with Google</span>
          </button>

          <button
            type="button"
            onClick={() => handleSSO('microsoft')}
            disabled={loading}
            className="w-full py-3.5 px-4 bg-zinc-800 hover:bg-zinc-750 text-white rounded-xl border border-zinc-700 flex items-center justify-center gap-3 font-medium text-sm transition-all shadow-md hover:border-emerald-500/50 disabled:opacity-50 cursor-pointer"
          >
            <svg className="w-5 h-5" viewBox="0 0 23 23">
              <path fill="#f35325" d="M1 1h10v10H1z"/>
              <path fill="#81bc06" d="M12 1h10v10H12z"/>
              <path fill="#05a6f0" d="M1 12h10v10H1z"/>
              <path fill="#ffba08" d="M12 12h10v10H12z"/>
            </svg>
            <span>Continue with Microsoft</span>
          </button>

          <button
            type="button"
            onClick={() => handleSSO('apple')}
            disabled={loading}
            className="w-full py-3.5 px-4 bg-zinc-800 hover:bg-zinc-750 text-white rounded-xl border border-zinc-700 flex items-center justify-center gap-3 font-medium text-sm transition-all shadow-md hover:border-emerald-500/50 disabled:opacity-50 cursor-pointer"
          >
            <svg className="w-5 h-5 fill-current" viewBox="0 0 170 170">
              <path d="M150.37 130.25c-2.45 5.66-5.35 10.87-8.71 15.66-4.58 6.53-8.33 11.05-11.22 13.56-4.48 4.12-9.28 6.23-14.42 6.35-3.69 0-8.14-1.05-13.32-3.18-5.19-2.12-9.97-3.17-14.34-3.17-4.58 0-9.49 1.05-14.75 3.17-5.26 2.13-9.5 3.24-12.74 3.35-4.33.13-9.13-1.9-14.4-6.08-3.81-3.04-7.84-7.86-12.08-14.46-8.22-12.79-14.37-26.68-18.45-41.67-4.08-14.99-6.12-28.78-6.12-41.37 0-15.82 3.86-29.07 11.58-39.75 7.72-10.68 17.65-16.14 29.79-16.39 5.22 0 10.84 1.25 16.86 3.75 6.02 2.5 10.2 3.75 12.54 3.75 1.84 0 6.13-1.32 12.87-3.96 6.74-2.64 12.19-3.83 16.36-3.58 13.25.63 23.72 5.56 31.42 14.8-11.83 7.15-17.6 17.07-17.3 29.76.25 10.02 4.14 18.23 11.67 24.63 7.53 6.4 16.48 10.08 26.85 11.04-2.65 8.12-6.19 16.03-10.62 23.73zM119.22 31.84c0-7.23 2.65-14.15 7.95-20.76 5.3-6.61 11.97-10.63 20.01-12.08.13 1.01.2 1.83.2 2.45 0 7.03-2.67 14-8.01 20.91-5.34 6.91-12.01 10.86-20.02 11.85-.06-.5-.13-1.29-.13-2.37z"/>
            </svg>
            <span>Continue with Apple</span>
          </button>
        </div>

        <div className="mt-6 pt-4 border-t border-zinc-800/80 flex items-center justify-between text-xs text-zinc-500">
          <div className="flex items-center gap-1.5">
            <Globe className="w-4 h-4 text-emerald-500" />
            <span>Domain: <code className="text-zinc-300 font-mono">{window.location.hostname}</code></span>
          </div>
          <span>v2.5</span>
        </div>
      </div>
    </div>
  );
};
