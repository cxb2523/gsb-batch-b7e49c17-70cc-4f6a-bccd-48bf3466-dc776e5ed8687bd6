import { AlertTriangle } from 'lucide-react';

/** Shown instead of the canvases while the member's project key has not been wrapped for them. */
export function PendingProjectAccess() {
  return (
    <div className="bg-white border border-warning-border rounded-2xl p-8 text-center flex flex-col items-center gap-3 mt-6">
      <div className="w-10 h-10 rounded-xl bg-warning-subtle text-warning flex items-center justify-center shrink-0">
        <AlertTriangle className="w-5 h-5" />
      </div>
      <h3 className="text-sm font-bold text-ink">Waiting for access</h3>
      <p className="text-xs text-ink-muted leading-relaxed max-w-sm">
        An administrator needs to grant you access. Your account is a member of this project, but
        the project key has not been wrapped for you yet. Nothing has been changed.
      </p>
    </div>
  );
}
