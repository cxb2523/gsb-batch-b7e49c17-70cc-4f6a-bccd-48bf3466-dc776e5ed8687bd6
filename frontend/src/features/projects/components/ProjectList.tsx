import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { Project } from '../schemas';

interface ProjectListProps {
  projects: Project[];
  activeProjectId: string | undefined;
  /** Canvas count shown for the active project when the list response carries no count. */
  activeProjectCanvasCount: number;
  canCreate: boolean;
  onSelect: (project: Project) => void;
  /** Resolves true when the project was created; the form stays as typed otherwise. */
  onCreate: (name: string) => Promise<boolean>;
}

export function ProjectList({
  projects,
  activeProjectId,
  activeProjectCanvasCount,
  canCreate,
  onSelect,
  onCreate,
}: ProjectListProps) {
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    if (await onCreate(name)) {
      setNewName('');
      setIsCreating(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between px-1 mb-1">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-muted font-semibold">
          Projects
        </span>
        {canCreate && (
          <button
            onClick={() => setIsCreating((prev) => !prev)}
            className="w-5 h-5 rounded-md hover:bg-brand-subtle text-ink-muted hover:text-ink flex items-center justify-center cursor-pointer font-bold text-sm transition-colors"
            title="New Project"
          >
            +
          </button>
        )}
      </div>

      {isCreating && (
        <form onSubmit={handleSubmit} className="flex items-center gap-1.5 px-1 mb-2">
          <Input
            type="text"
            placeholder="Project name..."
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            autoFocus
            className="flex-1 h-8 px-2.5 text-xs bg-white rounded-lg"
          />
          <Button type="submit" size="sm" className="h-8 px-2.5 text-[11px]">
            Add
          </Button>
        </form>
      )}

      <div className="flex flex-col gap-1">
        {projects.length === 0 ? (
          <div className="px-2.5 py-2 text-xs text-ink-subtle font-mono">
            No projects created yet.
          </div>
        ) : (
          projects.map((project) => {
            const isSelected = activeProjectId === project.id;
            const count = project._count?.boards ?? (isSelected ? activeProjectCanvasCount : 0);
            return (
              <button
                key={project.id}
                onClick={() => onSelect(project)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs transition-colors cursor-pointer ${
                  isSelected
                    ? 'bg-brand-subtle text-ink font-semibold'
                    : 'text-ink-muted hover:bg-surface-2 hover:text-ink'
                }`}
              >
                <div className="flex items-center gap-2.5 truncate">
                  <span className="text-xs text-brand">▦</span>
                  <span className="truncate">{project.name}</span>
                </div>
                {project.keyStatus === 'pending' ? (
                  <span className="font-mono text-[9px] ml-auto text-warning bg-warning-subtle border border-warning-border px-1.5 py-0.5 rounded">
                    PENDING
                  </span>
                ) : (
                  <span
                    className={`font-mono text-[10px] ml-auto ${isSelected ? 'text-brand font-semibold' : 'text-ink-subtle'}`}
                  >
                    {String(count).padStart(2, '0')}
                  </span>
                )}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
