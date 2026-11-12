import { AlertTriangle, Download, Key, ShieldCheck, User } from 'lucide-react';
import { useSession } from '@/lib/auth-client';
import { useLinkedAccounts } from '../queries';

const sectionLinkClass =
  'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium text-ink-muted hover:bg-surface-2 hover:text-ink transition-colors';

export function ProfileSidebar() {
  const { data: session } = useSession();
  const { data: accounts } = useLinkedAccounts();

  const initial = session?.user?.name
    ? session.user.name.trim().charAt(0).toUpperCase()
    : session?.user?.email
      ? session.user.email.trim().charAt(0).toUpperCase()
      : 'U';

  return (
    <aside className="w-full lg:w-[244px] bg-surface border-r border-border p-4 lg:p-5 flex flex-col min-h-[calc(100vh-3.5rem)] sm:min-h-[calc(100vh-4rem)] z-20">
      <div className="flex flex-col lg:sticky lg:top-20">
        <div className="flex items-center gap-2.5 p-2.5 bg-white border border-border rounded-xl shadow-2xs mb-5">
          <div className="w-8 h-8 rounded-lg bg-brand-tile text-brand-strong font-sans font-bold text-xs flex items-center justify-center shrink-0">
            {initial}
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-xs font-semibold text-ink truncate">
              {session?.user?.name || 'User'}
            </span>
            <span className="font-mono text-[10px] text-ink-subtle truncate">
              {session?.user?.email || ''}
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-muted font-semibold px-1 mb-1">
            Account Sections
          </span>
          <a href="#personal" className={sectionLinkClass}>
            <User className="w-3.5 h-3.5 text-brand" />
            <span>Personal Info</span>
          </a>
          <a href="#providers" className={`${sectionLinkClass} justify-between`}>
            <div className="flex items-center gap-2.5">
              <Key className="w-3.5 h-3.5 text-brand" />
              <span>Connected Accounts</span>
            </div>
            <span className="font-mono text-[10px] text-ink-subtle">{accounts?.length ?? 0}</span>
          </a>
          <a href="#security" className={sectionLinkClass}>
            <ShieldCheck className="w-3.5 h-3.5 text-brand" />
            <span>E2EE Security</span>
          </a>
          <a href="#privacy" className={sectionLinkClass}>
            <Download className="w-3.5 h-3.5 text-brand" />
            <span>Data & Privacy</span>
          </a>
          <a
            href="#danger"
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium text-danger hover:bg-danger-subtle transition-colors"
          >
            <AlertTriangle className="w-3.5 h-3.5 text-danger" />
            <span>Danger Zone</span>
          </a>
        </div>
      </div>
    </aside>
  );
}
