import { useState } from 'react';
import { Trash2, X } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { Pagination } from '@/components/Pagination';
import { GrantAccessDialog } from '@/features/projects/components/GrantAccessDialog';
import { useSession } from '@/lib/auth-client';
import {
  memberUserId,
  useProjectAccess,
  type PendingGrant,
} from '@/features/projects/hooks/useProjectAccess';
import { useAssignableMembers } from '@/features/projects/queries';
import { selectChevronStyle } from '@/features/workspaces/components/selectChevronStyle';
import { useAccess } from '@/hooks/useAccess';
import type { PageInfo } from '@/features/pagination';
import type { Project, ProjectMemberItem } from '@/features/projects/schemas';
import type { Workspace } from '@/features/workspaces/schemas';

/** The server's largest page; the picker is a plain list, so it takes the most it can in one go. */
const ASSIGNABLE_LIMIT = 100;

const projectRoleLabel = (role: string | undefined) => (role === 'admin' ? 'Project admin' : role);

interface ProjectAccessModalProps {
  workspace: Workspace;
  project: Project;
  /** The server's effective member list: explicit grants plus every workspace administrator. */
  members: ProjectMemberItem[];
  pagination: PageInfo;
  onPrevPage: () => void;
  onNextPage: () => void;
  canManage: boolean;
  runRotation: (projectIds: string[]) => Promise<void>;
  onClose: () => void;
}

export function ProjectAccessModal({
  workspace,
  project,
  members,
  pagination,
  onPrevPage,
  onNextPage,
  canManage,
  runRotation,
  onClose,
}: ProjectAccessModalProps) {
  const { isAdministrator } = useAccess(workspace.slug);
  const { data: session } = useSession();
  const currentUserId = session?.user?.id;
  const access = useProjectAccess({ workspace, project, runRotation, isAdministrator });
  const [assignUserId, setAssignUserId] = useState('');
  const [assignRole, setAssignRole] = useState('editor');
  const [pendingGrant, setPendingGrant] = useState<PendingGrant | null>(null);

  // Served by the project, not the workspace list, so a Project Admin who is only an Editor in the
  // workspace can pick people too. Asked for only by someone who may assign.
  const { data: assignableResult } = useAssignableMembers(
    workspace.id,
    canManage ? project.id : undefined,
    { limit: ASSIGNABLE_LIMIT },
  );
  const assignable = assignableResult?.items ?? [];

  const assign = async () => {
    if (!assignUserId) return;
    if (await access.assign(assignUserId, assignRole)) setAssignUserId('');
  };

  return (
    <>
      <Modal
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        showCloseButton={false}
        className="max-w-xl w-full bg-white border border-border rounded-2xl shadow-2xl p-6 flex flex-col gap-4 font-sans max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-start justify-between border-b border-border-subtle pb-3">
          <div>
            <h3 className="text-base font-bold text-ink">
              Project Access · {project.name || 'Project'}
            </h3>
            <p className="text-xs text-ink-muted mt-0.5">
              Choose who can view and edit this project's canvases.
            </p>
            <p className="text-xs text-ink-muted mt-0.5">
              These roles apply to this project only.
              {isAdministrator && " A person's workspace role is changed under Workspace Members."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-ink-subtle hover:text-ink p-1 rounded-md transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {canManage && (
          <div className="p-3.5 bg-surface border border-border rounded-xl flex flex-col gap-2.5">
            <span className="font-mono text-[10px] uppercase tracking-wider text-ink-muted font-semibold">
              ASSIGN MEMBER
            </span>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <select
                aria-label="Workspace member to assign"
                value={assignUserId}
                onChange={(e) => setAssignUserId(e.target.value)}
                className="h-9 px-3 pr-8 bg-white border border-border text-xs text-ink rounded-lg outline-none flex-1 min-w-0 truncate appearance-none cursor-pointer"
                style={selectChevronStyle}
              >
                <option value="">Select workspace member to assign...</option>
                {assignable.map((m) => (
                  <option key={`assign-opt-${m.userId}`} value={m.userId}>
                    {m.name} ({m.email})
                  </option>
                ))}
              </select>

              <select
                aria-label="Project role"
                value={assignRole}
                onChange={(e) => setAssignRole(e.target.value)}
                className="h-9 px-3 pr-8 bg-white border border-border text-xs rounded-lg outline-none font-mono shrink-0 appearance-none cursor-pointer"
                style={selectChevronStyle}
              >
                <option value="editor">Editor</option>
                <option value="admin">Project admin</option>
                <option value="viewer">Viewer</option>
              </select>

              <button
                type="button"
                onClick={() => void assign()}
                disabled={!assignUserId}
                className="h-9 px-4 bg-ink text-white text-xs font-semibold rounded-lg hover:bg-ink-hover disabled:opacity-50 cursor-pointer shadow-xs whitespace-nowrap shrink-0"
              >
                Assign Member
              </button>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between text-xs font-semibold text-ink px-1">
            <span>Project Members & Permissions</span>
            <span className="font-mono text-[10px] text-ink-muted">
              Project roles: Admin, Editor, Viewer
            </span>
          </div>

          <div className="divide-y divide-border-subtle flex flex-col">
            {members.map((pm) => (
              <div
                key={`proj-member-${pm.id}`}
                className="grid grid-cols-[1fr_auto] items-center gap-4 py-3 hover:bg-surface transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-full bg-avatar-blue-bg text-avatar-blue-text font-bold text-xs flex items-center justify-center shrink-0">
                    {pm.name ? pm.name.charAt(0).toUpperCase() : 'U'}
                  </div>
                  <div className="flex flex-col min-w-0">
                    <strong className="text-xs font-semibold text-ink truncate block">
                      {pm.name}
                    </strong>
                    <div className="flex items-center gap-1.5 text-[11px] text-ink-muted truncate font-mono">
                      <span className="truncate">{pm.email}</span>
                      <span>·</span>
                      <span className="capitalize">
                        {pm.source === 'workspace' ? 'Workspace admin' : projectRoleLabel(pm.role)}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {pm.source === 'workspace' ? (
                    <span className="font-mono text-[10px] uppercase font-semibold text-brand-strong bg-brand-subtle border border-brand-border px-2 py-0.5 rounded-md">
                      Admin (workspace)
                    </span>
                  ) : (
                    <>
                      {pm.keyStatus === 'pending' && (
                        <span className="font-mono text-[10px] uppercase font-semibold text-warning bg-warning-subtle border border-warning-border px-2 py-0.5 rounded-md">
                          Pending access
                        </span>
                      )}

                      {/* Your own row is read-only: changing or removing yourself here would lock you out of this very dialog. */}
                      {canManage && memberUserId(pm) !== currentUserId ? (
                        <>
                          {pm.keyStatus === 'pending' ? (
                            <button
                              type="button"
                              onClick={() => void access.beginGrant(pm).then(setPendingGrant)}
                              className="px-2.5 py-1 text-[11px] font-semibold bg-ink text-white rounded-md hover:bg-ink-hover cursor-pointer"
                            >
                              Grant access
                            </button>
                          ) : (
                            <select
                              aria-label={`Role for ${pm.name}`}
                              value={pm.role}
                              onChange={(e) => void access.changeRole(pm, e.target.value)}
                              className="font-mono text-[11px] bg-paper px-2.5 py-1 pr-8 rounded-md border border-border outline-none appearance-none cursor-pointer"
                              style={selectChevronStyle}
                            >
                              <option value="admin">Project admin</option>
                              <option value="editor">Editor</option>
                              <option value="viewer">Viewer</option>
                            </select>
                          )}

                          <button
                            type="button"
                            onClick={() => void access.removeMember(pm)}
                            title="Unassign from project"
                            className="text-ink-subtle hover:text-danger transition-colors p-1 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </>
                      ) : (
                        <span className="font-mono text-[11px] capitalize text-ink-muted px-2 py-1">
                          {projectRoleLabel(pm.role)}
                        </span>
                      )}
                    </>
                  )}
                </div>
              </div>
            ))}

            {members.length === 0 && (
              <div className="p-4 text-center text-xs text-ink-subtle font-mono">
                No specific members assigned. (Workspace admins have default access).
              </div>
            )}
          </div>

          <Pagination
            page={pagination.page}
            limit={pagination.limit}
            total={pagination.total}
            hasPrevPage={pagination.hasPrevPage}
            hasNextPage={pagination.hasNextPage}
            onPrev={onPrevPage}
            onNext={onNextPage}
            entityName="MEMBERS"
          />
        </div>

        <div className="flex items-center justify-end pt-2 border-t border-border-subtle">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-ink hover:bg-ink-hover text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer shadow-xs"
          >
            Done
          </button>
        </div>
      </Modal>

      {pendingGrant && (
        <GrantAccessDialog
          pending={pendingGrant}
          onCancel={() => setPendingGrant(null)}
          onConfirm={access.confirmGrant}
        />
      )}
    </>
  );
}
