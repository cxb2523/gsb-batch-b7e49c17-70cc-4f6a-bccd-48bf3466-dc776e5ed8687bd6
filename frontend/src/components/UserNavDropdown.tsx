import { useState, useRef, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useSession, signOut } from '@/lib/auth-client';
import { clearLocalKeyMaterial } from '@/lib/key-store';
import { User, LogOut, ChevronDown, BookOpen } from 'lucide-react';

export function UserNavDropdown() {
  const { data: session } = useSession();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        event.target instanceof Node &&
        !dropdownRef.current.contains(event.target)
      ) {
        setIsOpen(false);
      }
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, []);

  const handleLogout = async () => {
    setIsOpen(false);
    await clearLocalKeyMaterial();
    await signOut();
    void navigate('/login');
    if (typeof window !== 'undefined') {
      window.location.href = '/login';
    }
  };

  const initial = session?.user?.name?.trim()
    ? session.user.name.trim().charAt(0).toUpperCase()
    : session?.user?.email?.trim()
      ? session.user.email.trim().charAt(0).toUpperCase()
      : 'U';
  const displayName = session?.user?.name || 'User';
  const email = session?.user?.email || '';

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Avatar Button */}
      <button
        onClick={() => setIsOpen((prev) => !prev)}
        title={`${displayName} (Account menu)`}
        aria-label="User profile and account settings"
        aria-expanded={isOpen}
        className="flex items-center gap-1.5 p-0.5 rounded-full hover:ring-2 hover:ring-brand-border focus:outline-none transition-all cursor-pointer group"
      >
        <div className="w-7 h-7 rounded-full bg-brand-subtle border border-brand-border text-brand-strong flex items-center justify-center font-bold text-xs shadow-2xs group-hover:scale-105 transition-transform">
          {initial}
        </div>
        <ChevronDown className="w-3 h-3 text-ink-subtle group-hover:text-ink transition-colors hidden sm:block" />
      </button>

      {/* Inline Dropdown Popover */}
      {isOpen && (
        <div className="absolute right-0 mt-1.5 w-56 bg-white rounded-xl shadow-xl border border-border py-2 z-50 animate-in fade-in duration-100 font-sans">
          {/* User Header */}
          <div className="px-4 py-2 border-b border-border-subtle flex flex-col">
            <span className="text-xs font-semibold text-ink truncate">{displayName}</span>
            {email && (
              <span className="text-[11px] font-mono text-ink-muted truncate mt-0.5">{email}</span>
            )}
          </div>

          {/* Menu Actions */}
          <div className="py-1">
            <Link
              to="/profile"
              onClick={() => setIsOpen(false)}
              className="w-full flex items-center gap-2.5 px-4 py-2 text-xs font-medium text-ink hover:bg-paper transition-colors"
            >
              <User className="w-3.5 h-3.5 text-brand" />
              <span>Profile Settings</span>
            </Link>
            <Link
              to="/docs"
              onClick={() => setIsOpen(false)}
              className="w-full flex items-center gap-2.5 px-4 py-2 text-xs font-medium text-ink hover:bg-paper transition-colors"
            >
              <BookOpen className="w-3.5 h-3.5 text-brand" />
              <span>Documentation</span>
            </Link>
          </div>

          <div className="border-t border-border-subtle pt-1">
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-2.5 px-4 py-2 text-xs font-medium text-danger-muted hover:bg-danger-soft transition-colors cursor-pointer text-left"
            >
              <LogOut className="w-3.5 h-3.5 text-danger-muted" />
              <span>Log Out</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
