export function ProfileAsideNotes() {
  return (
    <aside className="hidden xl:flex flex-col gap-5 sticky top-20">
      <div className="bg-brand-subtle border border-metric-card-border rounded-2xl p-5 shadow-2xs">
        <div className="w-8 h-8 rounded-lg bg-white text-brand-metric flex items-center justify-center font-bold text-sm mb-2 shadow-2xs">
          ✳
        </div>
        <h3 className="text-sm font-bold text-ink mb-1.5">Security by default.</h3>
        <p className="text-xs text-brand-metric-text leading-relaxed">
          Your canvas is encrypted in your browser before saving. Only your passphrase can decrypt
          your private key.
        </p>
      </div>

      <div className="bg-surface-2 border border-metric-card-neutral-border rounded-2xl p-5 shadow-2xs">
        <div className="font-mono text-[10px] uppercase tracking-wider text-ink-muted font-semibold mb-1">
          DATA PRIVACY
        </div>
        <h3 className="text-sm font-bold text-ink mb-1.5">Your data stays portable.</h3>
        <p className="text-xs text-ink-muted leading-relaxed">
          Export your account data at any time in standard JSON. No lock-in, ever.
        </p>
      </div>
    </aside>
  );
}
