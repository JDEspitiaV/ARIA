import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[Uncaught Application Error]:', error, errorInfo);
  }

  public handleReset = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center p-6 text-center font-sans">
          <div className="max-w-md w-full bg-zinc-900 border border-zinc-800 rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mx-auto text-amber-400 font-bold text-xl">
              !
            </div>
            <h2 className="text-lg font-mono font-bold text-zinc-100">
              Recuperación del Sistema ARIA
            </h2>
            <p className="text-xs text-zinc-400 leading-relaxed">
              La interfaz detectó un error inesperado al renderizar el contenido. La sesión y tus datos están resguardados.
            </p>
            {this.state.error?.message && (
              <div className="text-[11px] font-mono text-rose-400 bg-zinc-950 p-2.5 rounded-lg border border-zinc-800 text-left overflow-x-auto max-h-24">
                {this.state.error.message}
              </div>
            )}
            <button
              onClick={this.handleReset}
              className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-mono font-bold text-xs transition cursor-pointer"
            >
              Reiniciar Interfaz
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
