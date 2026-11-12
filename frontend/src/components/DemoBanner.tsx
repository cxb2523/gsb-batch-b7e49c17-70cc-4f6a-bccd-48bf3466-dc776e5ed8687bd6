import { useAuthConfig } from '@/lib/auth-config';

export function DemoBanner() {
  const { config } = useAuthConfig();

  if (!config?.demoMode) {
    return null;
  }

  return (
    <div
      role="status"
      aria-label="Demo mode notice"
      className="bg-warning-subtle text-warning border-b border-warning-border px-4 py-2 text-xs font-medium flex items-center justify-center text-center gap-2 shrink-0 z-50"
    >
      <span>
        Demo mode: This is a public demonstration. All data and accounts are wiped nightly.
      </span>
    </div>
  );
}
