import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, Check, Plus } from 'lucide-react';
import { authClient } from '@/lib/auth-client';
import { useAccess } from '@/hooks/useAccess';

export interface WorkspaceItem {
  id: string;
  name: string;
  slug?: string | null | undefined;
  role?: string | undefined;
  encryptedOrgKey?: string | null | undefined;
  keyVersion?: number | undefined;
  keyRotationDue?: boolean | undefined;
  createdAt?: string | Date | undefined;
}

export interface WorkspaceSwitcherProps {
  currentWorkspace?: WorkspaceItem | null | undefined;
  workspaces: WorkspaceItem[];
  className?: string | undefined;
  onSelect?: ((org: WorkspaceItem) => void) | undefined;
}

export function WorkspaceSwitcher({
  currentWorkspace,
  workspaces,
  className = '',
  onSelect,
}: WorkspaceSwitcherProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { canCreateWorkspace } = useAccess();

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        e.target instanceof Node &&
        !containerRef.current.contains(e.target)
      ) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const handleSelectWorkspace = (org: WorkspaceItem) => {
    try {
      authClient?.organization?.setActive?.({ organizationId: org.id })?.catch?.(() => {});
    } catch {
      // Best-effort: the route and the workspace query decide what is shown, not the active-org flag.
    }
    setIsOpen(false);
    if (onSelect) {
      onSelect(org);
    } else {
      void navigate(`/w/${org.slug || org.id}`);
    }
  };

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="w-full flex items-center justify-between p-2.5 bg-white hover:bg-paper border border-border rounded-xl cursor-pointer transition-colors group shadow-2xs"
        aria-expanded={isOpen}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-brand-tile text-brand-strong font-sans font-bold text-xs flex items-center justify-center shrink-0">
            {(currentWorkspace?.name || 'W').charAt(0).toUpperCase()}
          </div>
          <span className="text-xs font-semibold text-ink truncate text-left">
            {currentWorkspace?.name || 'Workspace'}
          </span>
        </div>
        <ChevronDown
          className={`w-3.5 h-3.5 text-ink-subtle group-hover:text-ink transition-transform duration-200 shrink-0 ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>

      {isOpen && (
        <div className="absolute left-0 right-0 top-full mt-2 bg-white border border-border rounded-xl shadow-xl py-1.5 z-30 font-sans text-xs">
          <div className="px-3 py-1 font-mono text-[10px] uppercase text-ink-muted font-semibold tracking-wider">
            Workspaces
          </div>
          <div className="max-h-48 overflow-y-auto">
            {workspaces.map((org) => {
              const isCurrent = currentWorkspace?.id === org.id;
              return (
                <button
                  type="button"
                  key={org.id}
                  onClick={() => handleSelectWorkspace(org)}
                  className={`w-full px-3 py-2 text-left text-xs flex items-center justify-between hover:bg-paper cursor-pointer transition-colors ${
                    isCurrent ? 'font-semibold text-ink bg-brand-subtle' : 'text-ink'
                  }`}
                >
                  <span className="truncate">{org.name}</span>
                  {isCurrent && <Check className="w-3.5 h-3.5 text-success shrink-0" />}
                </button>
              );
            })}
          </div>
          {canCreateWorkspace && (
            <div className="border-t border-border-subtle mt-1 pt-1">
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  void navigate('/create-workspace');
                }}
                className="w-full px-3 py-2 text-left text-xs flex items-center gap-2 text-brand hover:text-brand-strong hover:bg-paper font-medium cursor-pointer transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Create Workspace</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
