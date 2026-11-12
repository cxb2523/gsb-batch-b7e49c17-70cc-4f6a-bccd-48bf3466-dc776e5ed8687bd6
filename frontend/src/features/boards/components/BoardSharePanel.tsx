import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Eye, Share2, Users } from 'lucide-react';
import { toast } from 'sonner';
import { ENCRYPTED_CHIP } from '@/lib/copy';
import { exportKeyToHash } from '@/lib/crypto';
import { disablePublicShare, enablePublicShare } from '../api';
import { boardKeys } from '../keys';
import type { Board } from '../schemas';

interface BoardSharePanelProps {
  workspaceRef: string;
  boardId: string;
  /** The public link's token, or null while the board is not shared. */
  publicShareToken: string | null;
  /** The board key, which goes into the link's fragment and never reaches the server. */
  cryptoKey: CryptoKey | null;
  /** Owners and admins, who can add people to the project; others are not pointed at that page. */
  canManageMembers: boolean;
}

/** The Share button and its popover: the public read-only link and a pointer to member access. */
export function BoardSharePanel({
  workspaceRef,
  boardId,
  publicShareToken,
  cryptoKey,
  canManageMembers,
}: BoardSharePanelProps) {
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [copied, setCopied] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const isPublic = Boolean(publicShareToken);

  useEffect(() => {
    const closeOnOutsideClick = (e: MouseEvent) => {
      if (
        e.target instanceof Node &&
        containerRef.current &&
        !containerRef.current.contains(e.target)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    return () => document.removeEventListener('mousedown', closeOnOutsideClick);
  }, []);

  const togglePublicShare = async () => {
    if (isUpdating) return;
    setIsUpdating(true);
    try {
      let token: string | null = null;
      if (isPublic) {
        await disablePublicShare(workspaceRef, boardId);
      } else {
        token = (await enablePublicShare(workspaceRef, boardId)).publicShareToken ?? null;
      }
      queryClient.setQueryData<Board>(boardKeys.detail(workspaceRef, boardId), (board) =>
        board ? { ...board, publicShareToken: token } : board,
      );
    } catch (err) {
      console.error('Failed to toggle public sharing', err);
      toast.error(
        isPublic ? 'Failed to disable public sharing' : 'Failed to enable public sharing',
      );
    } finally {
      setIsUpdating(false);
    }
  };

  const copyPublicLink = async () => {
    if (!publicShareToken) return;

    let keyFragment: string | null = null;
    if (cryptoKey) {
      try {
        keyFragment = await exportKeyToHash(cryptoKey);
      } catch (err) {
        console.error('Failed to export key to hash', err);
      }
    }
    if (!keyFragment || keyFragment.trim().length === 0) {
      toast.error('Failed to export encryption key. Cannot generate public share link.');
      return;
    }

    const publicUrl = `${window.location.origin}/share/${publicShareToken}#key=${keyFragment}`;
    try {
      await navigator.clipboard.writeText(publicUrl);
    } catch {
      // The clipboard can be denied; a prompt still lets the user copy the link by hand.
      prompt('Copy public read-only link:', publicUrl);
      return;
    }
    setCopied(true);
    toast.success('Public share link copied to clipboard', {
      description:
        'The link contains the read-only share token and decryption key in the hash fragment.',
    });
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setIsOpen((open) => !open)}
        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-ink hover:bg-ink-hover text-white text-xs font-mono font-semibold transition-colors cursor-pointer rounded-lg shadow-sm"
        title="Share Canvas"
      >
        <Share2 className="w-3.5 h-3.5" />
        <span>Share</span>
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-white border border-border rounded-2xl shadow-2xl p-4 z-50 flex flex-col gap-3 font-sans text-xs text-left">
          <div className="flex items-center justify-between border-b border-border-subtle pb-2.5">
            <span className="text-[10px] text-ink-muted font-bold uppercase tracking-wider font-mono">
              SHARE CANVAS
            </span>
            <span className="text-[9px] bg-brand-subtle text-brand-strong px-1.5 py-0.5 rounded-md border border-brand-border font-mono font-bold uppercase">
              {ENCRYPTED_CHIP}
            </span>
          </div>

          <>
            <div className="flex flex-col gap-2 p-3 bg-surface border border-border rounded-xl">
              <div className="flex items-center justify-between">
                <span className="font-bold text-ink flex items-center gap-1.5 text-xs">
                  <Eye className="w-3.5 h-3.5 text-brand" />
                  <span>Public Share Link</span>
                </span>
                <button
                  type="button"
                  onClick={() => void togglePublicShare()}
                  disabled={isUpdating}
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${isPublic ? 'bg-ink' : 'bg-border-strong'}`}
                  role="switch"
                  aria-checked={isPublic}
                  title={isPublic ? 'Disable public link' : 'Enable public link'}
                >
                  <span
                    className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${isPublic ? 'translate-x-4' : 'translate-x-0'}`}
                  />
                </button>
              </div>

              {isPublic ? (
                <div className="flex flex-col gap-2 pt-2 border-t border-border">
                  <p className="text-[11px] text-ink-muted leading-snug">
                    Anyone with this link can view this canvas in strictly read-only mode.
                  </p>
                  <button
                    onClick={() => void copyPublicLink()}
                    className="w-full py-2 px-3 bg-ink hover:bg-ink-hover text-white font-mono text-[11px] font-semibold uppercase tracking-wider rounded-lg transition-colors cursor-pointer text-center flex items-center justify-center gap-1.5 shadow-sm"
                  >
                    {copied ? (
                      <Check className="w-3.5 h-3.5 text-success-bright" />
                    ) : (
                      <Share2 className="w-3.5 h-3.5" />
                    )}
                    <span>{copied ? 'Link Copied!' : 'Copy Public Link'}</span>
                  </button>
                </div>
              ) : (
                <p className="text-[11px] text-ink-muted leading-snug">
                  Public sharing is disabled. Only project members can access this canvas.
                </p>
              )}
            </div>

            {canManageMembers && (
              <div className="flex flex-col gap-1.5 p-3 bg-surface border border-border rounded-xl">
                <span className="font-bold text-ink text-xs uppercase tracking-wider flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-brand" />
                  <span>Project Collaborators</span>
                </span>
                <p className="text-[11px] text-ink-muted leading-snug">
                  Canvas editing is restricted to project members. Add colleagues to this project to
                  grant collaborative editing access.
                </p>
                <Link
                  to={`/w/${workspaceRef}/management`}
                  className="mt-1 w-full py-2 px-3 bg-white hover:bg-paper text-ink border border-border font-mono text-[11px] font-semibold uppercase tracking-wider rounded-lg transition-colors text-center inline-block shadow-2xs"
                >
                  Manage Project Members
                </Link>
              </div>
            )}
          </>
        </div>
      )}
    </div>
  );
}
