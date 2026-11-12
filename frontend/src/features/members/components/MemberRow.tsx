import { Trash2 } from 'lucide-react';
import { selectChevronStyle } from '@/features/workspaces/components/selectChevronStyle';
import type { WorkspaceMember } from '@/features/members/schemas';

interface MemberRowProps {
  member: WorkspaceMember;
  isCurrentUser: boolean;
  canChangeRole: boolean;
  canTransfer: boolean;
  canRemove: boolean;
  onRoleChange: (role: string) => void;
  onTransfer: () => void;
  onRemove: () => void;
}

export function MemberRow({
  member,
  isCurrentUser,
  canChangeRole,
  canTransfer,
  canRemove,
  onRoleChange,
  onTransfer,
  onRemove,
}: MemberRowProps) {
  const isOwner = member.role === 'owner';
  // Whoever cannot be changed from here shows the role as a pill: the Owner, and you yourself, since
  // stepping down would take you out of this very page.
  const canEditRole = canChangeRole && !isCurrentUser && !isOwner;

  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-4 py-3 hover:bg-surface transition-colors">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-9 h-9 rounded-full bg-avatar-blue-bg text-avatar-blue-text font-bold text-xs flex items-center justify-center shrink-0">
          {member.name ? member.name.charAt(0).toUpperCase() : 'U'}
        </div>
        <div className="flex flex-col min-w-0">
          <strong className="text-xs font-semibold text-ink truncate block">
            {member.name}{' '}
            {isCurrentUser && <span className="text-ink-subtle font-normal">(You)</span>}
          </strong>
          <div className="flex items-center gap-1.5 text-[11px] text-ink-muted truncate font-mono">
            <span className="truncate">{member.email}</span>
            <span>·</span>
            <span className="capitalize">{member.role}</span>
            <span>·</span>
            <span className="text-brand-strong font-medium">Active</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {canEditRole ? (
          <select
            aria-label={`Role for ${member.name || member.email}`}
            value={member.role}
            onChange={(e) => onRoleChange(e.target.value)}
            className="bg-paper border border-border font-mono text-[11px] text-ink px-2.5 py-1 pr-8 rounded-md outline-none appearance-none cursor-pointer"
            style={selectChevronStyle}
          >
            <option value="admin">Admin</option>
            <option value="editor">Editor</option>
            <option value="viewer">Viewer</option>
          </select>
        ) : (
          <span className="font-mono text-[10px] text-ink-muted bg-surface-pill border border-border px-2 py-0.5 rounded-md font-semibold uppercase">
            {member.role}
          </span>
        )}

        {canTransfer && member.role === 'admin' && !isCurrentUser && (
          <button
            type="button"
            onClick={onTransfer}
            className="px-2.5 py-1 text-[11px] font-mono bg-white hover:bg-surface-2 border border-border text-ink rounded-md transition-colors cursor-pointer shadow-2xs"
          >
            Transfer ownership
          </button>
        )}

        {canRemove && !isOwner && !isCurrentUser && (
          <button
            type="button"
            onClick={onRemove}
            title="Remove member"
            className="text-ink-subtle hover:text-danger transition-colors p-1 cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
