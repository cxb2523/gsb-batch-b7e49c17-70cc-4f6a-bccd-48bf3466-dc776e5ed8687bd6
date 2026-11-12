import { useState } from 'react';
import { NOT_A_CREDENTIAL } from '@/lib/form-attributes';
import { X } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { errorMessage } from '@/lib/errors';
import { inviteWorkspaceMember } from '@/features/members/api';
import { useWorkspaceInvalidation } from '@/features/workspaces/hooks/useWorkspaceInvalidation';
import { selectChevronStyle } from '@/features/workspaces/components/selectChevronStyle';
import type { Project } from '@/features/projects/schemas';

/** What to show next to the member list after an invitation: the invite link, or why it failed. */
export interface InviteFeedback {
  tone: 'success' | 'error';
  message: string;
}

interface InviteMemberModalProps {
  workspaceId: string;
  projects: Project[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onResult: (feedback: InviteFeedback) => void;
}

export function InviteMemberModal({
  workspaceId,
  projects,
  open,
  onOpenChange,
  onResult,
}: InviteMemberModalProps) {
  const { invalidateMembers } = useWorkspaceInvalidation(workspaceId);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('editor');
  const [projectIds, setProjectIds] = useState<string[]>([]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    try {
      const invitation = await inviteWorkspaceMember(workspaceId, {
        email: email.trim(),
        role,
        ...(projectIds.length > 0 ? { projectIds } : {}),
      });
      onResult({
        tone: 'success',
        message: `Invitation created for ${invitation.email}! Invite URL: ${invitation.inviteUrl ?? ''}`,
      });
      setEmail('');
      setProjectIds([]);
      invalidateMembers();
    } catch (err) {
      onResult({ tone: 'error', message: errorMessage(err) ?? 'Failed to invite member' });
    }
    onOpenChange(false);
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      showCloseButton={false}
      titleId="invite-member-title"
      className="max-w-md w-full bg-white border border-border rounded-2xl shadow-2xl p-6 flex flex-col gap-4 font-sans"
    >
      <div className="flex items-start justify-between border-b border-border-subtle pb-3">
        <div>
          <h3 id="invite-member-title" className="text-base font-bold text-ink">
            Invite a teammate
          </h3>
          <p className="text-xs text-ink-muted mt-0.5">
            Bring the right people into your workspace.
          </p>
        </div>
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          className="text-ink-subtle hover:text-ink p-1 rounded-md transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="invite-email" className="text-xs font-semibold text-ink">
            Email address
          </Label>
          <Input
            {...NOT_A_CREDENTIAL}
            id="invite-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="colleague@company.com"
            required
            className="h-9 px-3 bg-paper border border-border rounded-xl text-xs text-ink outline-none focus:bg-white focus:border-ink transition-colors"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="invite-role" className="text-xs font-semibold text-ink">
            Workspace role
          </Label>
          <select
            id="invite-role"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="h-9 px-3 pr-8 bg-paper border border-border rounded-xl font-mono text-xs text-ink outline-none appearance-none cursor-pointer"
            style={selectChevronStyle}
          >
            <option value="editor">Editor</option>
            <option value="viewer">Viewer</option>
          </select>
          <p className="text-[11px] text-ink-muted leading-relaxed">
            Invitations grant Editor or Viewer. To make someone an Admin, promote them after they
            join.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-ink">Projects to pre-assign (optional)</span>
          {projects.length === 0 ? (
            <p className="text-[11px] text-ink-muted">
              This workspace has no projects to pre-assign yet.
            </p>
          ) : (
            <div className="flex flex-col gap-1 max-h-40 overflow-y-auto border border-border rounded-xl p-2.5 bg-paper">
              {projects.map((project) => (
                <label
                  key={`invite-project-${project.id}`}
                  className="flex items-center gap-2 text-xs text-ink cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={projectIds.includes(project.id)}
                    onChange={(e) =>
                      setProjectIds((previous) =>
                        e.target.checked
                          ? [...previous, project.id]
                          : previous.filter((id) => id !== project.id),
                      )
                    }
                    className="accent-ink"
                  />
                  <span className="truncate">{project.name}</span>
                </label>
              ))}
            </div>
          )}
          <p className="text-[11px] text-ink-muted leading-relaxed">
            Pre-assigned projects start as “waiting for access”. An administrator grants the key
            explicitly after the person joins.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-border-subtle">
          <Button variant="outline" size="sm" type="button" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" size="sm">
            Send Invite
          </Button>
        </div>
      </form>
    </Modal>
  );
}
