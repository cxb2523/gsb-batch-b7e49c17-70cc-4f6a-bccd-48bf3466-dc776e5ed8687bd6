import { useState } from 'react';
import { NOT_A_CREDENTIAL } from '@/lib/form-attributes';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useCreateProject } from '@/features/projects/hooks/useCreateProject';
import type { Workspace } from '@/features/workspaces/schemas';

/** The same form is offered in the sidebar (compact) and above the project list (full). */
export function NewProjectForm({
  workspace,
  variant,
  onDone,
}: {
  workspace: Workspace | null;
  variant: 'sidebar' | 'section';
  onDone: () => void;
}) {
  const createProject = useCreateProject(workspace);
  const [name, setName] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    if ((await createProject(name.trim())) !== null) {
      setName('');
      onDone();
    }
  };

  if (variant === 'sidebar') {
    return (
      <form onSubmit={submit} className="flex items-center gap-1.5 px-1 mb-2">
        <Input
          {...NOT_A_CREDENTIAL}
          type="text"
          placeholder="Project name..."
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          className="flex-1 h-8 px-2.5 text-xs bg-white rounded-lg"
        />
        <Button type="submit" size="sm" className="h-8 px-2.5 text-[11px]">
          Add
        </Button>
      </form>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="p-3 bg-paper border border-border rounded-xl flex items-center gap-2"
    >
      <Input
        {...NOT_A_CREDENTIAL}
        type="text"
        placeholder="Enter project name..."
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus
        required
        className="flex-1 h-8 px-3 bg-white rounded-lg text-xs"
      />
      <Button type="button" variant="ghost" size="sm" onClick={onDone}>
        Cancel
      </Button>
      <Button type="submit" size="sm">
        Create
      </Button>
    </form>
  );
}
