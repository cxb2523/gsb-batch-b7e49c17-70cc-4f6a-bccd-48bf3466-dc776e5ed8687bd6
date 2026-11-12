import { useState } from 'react';
import { useParams, Link, useLocation } from 'react-router-dom';
import { Lock, AlertTriangle, KeyRound, ExternalLink } from 'lucide-react';
import { Excalidraw } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import { parseBoardHash } from '@/lib/crypto';
import { CanvLogo } from '@/components/CanvLogo';
import { ENCRYPTED_CANVAS_LONG_LABEL, ENCRYPTED_CANVAS_PUBLIC } from '@/lib/copy';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { usePublicBoard, usePublicBoardPayload } from '@/features/public-boards/queries';
import { usePublicBoardOpening } from '@/features/public-boards/hooks/usePublicBoardOpening';
import { ApiError } from '@/lib/http';

export function PublicBoardView() {
  const { token } = useParams<{ token: string }>();
  const location = useLocation();

  // The key comes from the link's fragment, which the browser never sends to a server, or from
  // what the viewer pastes in.
  const [manualKeyInput, setManualKeyInput] = useState('');
  const [appliedManualKey, setAppliedManualKey] = useState<string | null>(null);
  const keyText = appliedManualKey ?? parseBoardHash(location.hash).key;

  const boardQuery = usePublicBoard(token);
  const metadata = boardQuery.data;
  const payloadQuery = usePublicBoardPayload(token, Boolean(metadata?.hasPayload && keyText));
  const opening = usePublicBoardOpening(
    metadata,
    keyText,
    appliedManualKey === null ? 'hash' : 'manual',
    payloadQuery.data,
    token,
  );
  const scene = opening && 'scene' in opening ? opening.scene : null;
  const keyError = opening && 'error' in opening ? opening.error : '';

  const handleApplyManualKey = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualKeyInput.trim()) return;
    setAppliedManualKey(manualKeyInput.trim());
  };

  // 1. Not found or revoked
  if (boardQuery.error instanceof ApiError && boardQuery.error.status === 404) {
    return (
      <div className="w-screen h-screen flex flex-col items-center justify-center bg-paper font-mono p-4">
        <div className="w-full max-w-md bg-white border border-border rounded-2xl shadow-xl p-6 sm:p-8 flex flex-col gap-4 text-center">
          <div className="w-12 h-12 bg-red-50 text-red-600 border border-red-200 rounded-xl mx-auto flex items-center justify-center">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-ink uppercase tracking-wider">
              Access Restricted
            </h1>
            <p className="text-xs text-ink-secondary mt-2 leading-relaxed">
              This canvas does not exist, or its public link has been revoked by the owner.
            </p>
          </div>
          <div className="pt-2 border-t border-border-subtle flex justify-center">
            <Link
              to="/"
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-brand hover:bg-brand-hover text-white text-xs font-semibold rounded-xl uppercase tracking-wider transition-colors shadow-2xs"
            >
              <span>Go to CanvHQ Home</span>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // 2. Any other failure to read the canvas can be retried
  if (boardQuery.error || payloadQuery.error) {
    return (
      <div className="w-screen h-screen flex items-center justify-center bg-paper">
        <ErrorState
          title="Unable to load public canvas"
          message="The canvas could not be fetched just now. Check your connection and try again."
          onRetry={() => void (boardQuery.error ? boardQuery.refetch() : payloadQuery.refetch())}
        />
      </div>
    );
  }

  // 3. Loading, including while a key is being tried
  const isOpening = Boolean(keyText) && !opening;
  if (!scene && (boardQuery.isPending || isOpening)) {
    return (
      <div className="w-screen h-screen flex items-center justify-center bg-paper">
        <LoadingState message="Loading public canvas..." />
      </div>
    );
  }

  return (
    <div className="w-screen h-screen flex flex-col bg-paper overflow-hidden select-none font-sans antialiased">
      {/* Precision Read-Only Header */}
      <header className="h-14 w-full bg-white/95 backdrop-blur-md border-b border-border px-4 sm:px-6 flex items-center justify-between z-20 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 font-mono text-xs">
            <CanvLogo className="w-6 h-6 shrink-0" />
            <span className="font-semibold text-ink tracking-tight">CanvHQ</span>
            <span className="px-2 py-0.5 bg-surface-2 text-ink border border-border rounded-md text-[10px] uppercase font-bold tracking-wider">
              PUBLIC VIEW
            </span>
          </div>

          <span className="w-1 h-1 rounded-full bg-border-strong" />

          <h1 className="text-xs sm:text-sm font-bold text-ink tracking-tight truncate max-w-[200px] sm:max-w-[400px]">
            {metadata?.title || 'Shared Canvas'}
          </h1>
        </div>

        <div className="flex items-center gap-3 font-mono text-xs">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-warning-subtle border border-warning-border rounded-full text-[11px] text-warning font-bold uppercase tracking-wider">
            <Lock className="w-3 h-3 text-warning-amber" />
            <span>READ-ONLY VIEW</span>
          </div>

          <Link
            to="/login"
            className="hidden sm:inline-flex items-center gap-1.5 text-xs font-mono font-medium text-ink hover:text-ink bg-white hover:bg-paper border border-border rounded-lg px-2.5 py-1.5 shadow-2xs transition-colors"
          >
            <span>Open CanvHQ</span>
            <ExternalLink className="w-3.5 h-3.5 text-brand" />
          </Link>
        </div>
      </header>

      {/* Excalidraw Canvas Area (Strict View-Only Mode) */}
      <main className="flex-1 w-full h-[calc(100vh-3.5rem)] relative bg-white">
        {scene ? (
          <Excalidraw
            initialData={{
              elements: scene.elements || [],
              ...(scene.appState ? { appState: scene.appState } : {}),
              files: scene.files || {},
            }}
            viewModeEnabled={true}
            zenModeEnabled={false}
            gridModeEnabled={true}
            theme="light"
            UIOptions={{
              canvasActions: {
                changeViewBackgroundColor: false,
                clearCanvas: false,
                loadScene: false,
                saveToActiveFile: false,
                toggleTheme: false,
                saveAsImage: true,
              },
            }}
          />
        ) : (
          /* Missing or Invalid Encryption Key Dialog */
          <div className="absolute inset-0 bg-ink/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
            <div className="w-full max-w-md bg-white border border-border rounded-2xl shadow-2xl p-6 sm:p-7 font-mono flex flex-col gap-4">
              <div className="flex items-center gap-3 border-b border-border-subtle pb-3">
                <div className="w-9 h-9 rounded-xl bg-brand-subtle text-brand border border-border flex items-center justify-center shrink-0">
                  <KeyRound className="w-4 h-4 text-brand" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-ink uppercase tracking-wider">
                    Decryption Key Required
                  </h2>
                  <p className="text-[11px] text-ink-muted font-sans font-normal">
                    {ENCRYPTED_CANVAS_LONG_LABEL}
                  </p>
                </div>
              </div>

              <p className="text-xs text-ink-secondary leading-relaxed font-sans">
                This canvas is end-to-end encrypted. The canvas key is not sent to the server. If
                the link did not contain the decryption key in its hash fragment, paste it below to
                view.
              </p>

              {keyError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>{keyError}</span>
                </div>
              )}

              <form onSubmit={handleApplyManualKey} className="flex flex-col gap-3">
                <input
                  type="text"
                  placeholder="Paste #key=... or base64 key"
                  value={manualKeyInput}
                  onChange={(e) => setManualKeyInput(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-border focus:border-brand focus:outline-none text-xs font-mono bg-white"
                  autoFocus
                />
                <button
                  type="submit"
                  disabled={!manualKeyInput.trim()}
                  className="w-full py-2.5 bg-brand hover:bg-brand-hover disabled:opacity-50 text-white text-xs font-semibold rounded-xl uppercase tracking-wider transition-colors cursor-pointer shadow-2xs"
                >
                  Decrypt Canvas
                </button>
              </form>
            </div>
          </div>
        )}
      </main>

      {/* Floating Read-Only Footer HUD */}
      <footer className="h-7 w-full bg-ink border-t border-ink-pill-bg px-4 sm:px-6 flex items-center justify-between text-[10px] font-mono text-ink-footer-text z-10 select-none">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-emerald-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span>{ENCRYPTED_CANVAS_PUBLIC.toUpperCase()}</span>
          </span>
          <span className="hidden sm:inline text-ink-tertiary">|</span>
          <span className="hidden sm:inline text-amber-300 font-semibold">
            ACCESS: PUBLIC READ-ONLY
          </span>
        </div>
        <div>
          <span>CANVHQ PUBLIC VIEWER</span>
        </div>
      </footer>
    </div>
  );
}
