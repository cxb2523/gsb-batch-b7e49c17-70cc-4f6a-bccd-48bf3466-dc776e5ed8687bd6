import { useState } from 'react';
import { NOT_A_CREDENTIAL } from '@/lib/form-attributes';
import { Check, Edit2, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { errorMessage } from '@/lib/errors';
import { updateProject } from '@/features/projects/api';
import { useWorkspaceInvalidation } from '@/features/workspaces/hooks/useWorkspaceInvalidation';
import type { Project } from '@/features/projects/schemas';

interface ProjectRowProps {
  workspaceId: string;
  project: Project;
  accessCount: number;
  roleLabel: string;
  canRename: boolean;
  canDelete: boolean;
  onManageAccess: () => void;
  onDelete: () => void;
}

export function ProjectRow({
  workspaceId,
  project,
  accessCount,
  roleLabel,
  canRename,
  canDelete,
  onManageAccess,
  onDelete,
}: ProjectRowProps) {
  const { invalidateProjects } = useWorkspaceInvalidation(workspaceId);
  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState(project.name);

  const rename = async () => {
    if (!name.trim()) return;
    try {
      await updateProject(workspaceId, project.id, { name: name.trim() });
      invalidateProjects();
      setIsEditing(false);
    } catch (err) {
      toast.error(errorMessage(err) ?? 'The project could not be renamed.');
    }
  };

  return (
    <div className="py-3.5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        {isEditing ? (
          <div className="flex items-center gap-2 flex-1 max-w-sm">
            <Input
              {...NOT_A_CREDENTIAL}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              className="h-7 px-2 text-xs border border-ink rounded-lg outline-none flex-1"
            />
            <button
              onClick={() => void rename()}
              aria-label="Save project name"
              className="p-1 bg-ink text-white rounded-md hover:bg-ink-hover cursor-pointer"
            >
              <Check className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setIsEditing(false)}
              aria-label="Cancel renaming"
              className="p-1 text-ink-muted hover:bg-surface-2 rounded-md cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-brand-subtle border border-brand-border text-brand font-bold text-xs flex items-center justify-center shrink-0">
              {project.name.charAt(0).toUpperCase()}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-ink">{project.name}</span>
              <span className="font-mono text-[10px] bg-paper text-ink-muted border border-border px-1.5 py-0.5 rounded-md">
                {project._count?.boards || 0} canvases
              </span>
              <span
                className="font-mono text-[10px] bg-paper text-ink-muted border border-border px-1.5 py-0.5 rounded-md capitalize"
                data-testid="project-role-badge"
              >
                {roleLabel}
              </span>
              {canRename && (
                <button
                  onClick={() => {
                    setName(project.name);
                    setIsEditing(true);
                  }}
                  title="Rename project"
                  className="text-ink-subtle hover:text-ink p-0.5 transition-colors cursor-pointer"
                >
                  <Edit2 className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
        )}

        <div className="flex items-center gap-2">
          <button
            onClick={onManageAccess}
            className="text-[11px] font-semibold px-3 py-1.5 rounded-lg transition-colors cursor-pointer bg-surface-2 hover:bg-surface-2-hover text-ink border border-border shadow-2xs flex items-center gap-1.5"
          >
            <span>Manage Access</span>
            <span className="font-mono text-[10px] text-brand">({accessCount})</span>
            <span className="text-ink-subtle">↗</span>
          </button>

          {canDelete && (
            <button
              onClick={onDelete}
              title="Delete Project"
              className="text-ink-subtle hover:text-danger transition-colors p-1 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
