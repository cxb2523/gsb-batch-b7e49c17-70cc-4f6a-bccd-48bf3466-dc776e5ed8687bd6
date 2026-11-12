import { useUserMetrics } from '@/features/user/queries';
import { APP_VERSION } from '@/lib/constants';

interface AuthenticatedFooterProps {
  version?: string;
  className?: string;
}

export function AuthenticatedFooter({
  version = APP_VERSION.toUpperCase(),
  className = '',
}: AuthenticatedFooterProps) {
  const { workspacesCount, projectsCount } = useUserMetrics();

  return (
    <footer
      className={`w-full bg-white/95 backdrop-blur-md border-t border-border font-mono text-[11px] text-ink-muted sticky bottom-0 z-40 ${className}`}
    >
      <div className="w-full max-w-[94rem] mx-auto px-4 sm:px-8 h-10 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-success" />
          <span className="font-semibold text-ink tracking-wider">E2EE</span>
        </div>

        <div className="hidden sm:flex items-center gap-6">
          <span>{workspacesCount} Workspaces</span>
          <span className="text-border-strong">·</span>
          <span>{projectsCount} Projects</span>
        </div>

        <div className="flex items-center gap-2 text-ink-subtle">
          <span className="text-ink font-semibold tracking-tight uppercase">CANVHQ {version}</span>
        </div>
      </div>
    </footer>
  );
}
