import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import { CanvLogo } from '@/components/CanvLogo';
import { UserNavDropdown } from '@/components/UserNavDropdown';
import { NotificationBell } from '@/features/notifications/components/NotificationBell';
import { useAccess } from '@/hooks/useAccess';
import { cn } from '@/lib/utils';

export interface AppHeaderProps {
  currentSlug?: string | undefined;
  activeTab?: 'projects' | 'management' | 'none' | undefined;
  rotationProgress?: string | null | undefined;
  onOpenCommandPalette?: (() => void) | undefined;
  className?: string | undefined;
}

export function AppHeader({
  currentSlug,
  activeTab = 'none',
  rotationProgress,
  onOpenCommandPalette,
  className,
}: AppHeaderProps) {
  const homePath = currentSlug ? `/w/${currentSlug}` : '/workspace';
  const { role, isAdministrator } = useAccess(currentSlug);

  return (
    <header
      className={cn(
        'fixed top-0 left-0 right-0 z-40 bg-white/90 backdrop-blur-md border-b border-border',
        className,
      )}
    >
      <div className="h-14 sm:h-16 w-full max-w-[94rem] mx-auto px-4 sm:px-8 flex items-center justify-between">
        <div className="flex items-center gap-4 sm:gap-8">
          <Link to={homePath} className="flex items-center gap-2.5 group" aria-label="CanvHQ home">
            <CanvLogo className="w-6 h-6 shrink-0 transition-transform group-hover:scale-105" />
            <span className="text-[17px] font-bold tracking-[-0.035em] text-ink">CanvHQ</span>
          </Link>

          {currentSlug && (
            <nav className="flex items-center gap-1.5" aria-label="Workspace navigation">
              <Link
                to={`/w/${currentSlug}`}
                className={cn(
                  'px-3 py-1.5 text-xs rounded-md transition-colors',
                  activeTab === 'projects'
                    ? 'font-semibold bg-ink text-white active'
                    : 'font-medium text-ink-muted hover:text-ink hover:bg-surface-2',
                )}
              >
                Projects
              </Link>
              {isAdministrator && (
                <Link
                  to={`/w/${currentSlug}/management`}
                  className={cn(
                    'px-3 py-1.5 text-xs rounded-md transition-colors',
                    activeTab === 'management'
                      ? 'font-semibold bg-ink text-white active'
                      : 'font-medium text-ink-muted hover:text-ink hover:bg-surface-2',
                  )}
                >
                  Management
                </Link>
              )}
            </nav>
          )}
        </div>

        <div className="flex items-center gap-3">
          {role && (
            <span
              data-testid="role-badge"
              className="font-mono text-[10px] uppercase font-semibold px-2 py-0.5 rounded-md border border-border bg-surface-2 text-ink-muted"
            >
              {role}
            </span>
          )}

          {onOpenCommandPalette && (
            <button
              type="button"
              onClick={onOpenCommandPalette}
              className="flex items-center gap-2.5 px-3 py-1.5 font-mono text-xs text-ink-muted hover:text-ink bg-white hover:bg-paper border border-border rounded-lg shadow-2xs transition-colors cursor-pointer"
              title="Search (⌘K)"
            >
              <Search className="w-3.5 h-3.5 text-brand" />
              <span className="hidden sm:inline">Search</span>
              <kbd className="bg-brand-subtle border border-brand-border text-brand text-[10px] px-1.5 py-0.5 rounded">
                ⌘K
              </kbd>
            </button>
          )}

          {rotationProgress && (
            <span className="hidden sm:inline-flex items-center gap-1.5 font-mono text-[10px] text-warning bg-warning-subtle border border-warning-border px-2.5 py-1 rounded-lg">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-600 animate-pulse" />
              {rotationProgress}
            </span>
          )}

          <NotificationBell />

          <UserNavDropdown />
        </div>
      </div>
    </header>
  );
}
