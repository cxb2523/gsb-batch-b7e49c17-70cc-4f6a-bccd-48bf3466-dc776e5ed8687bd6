import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ProjectList } from './ProjectList';

const projects = [
  { id: 'p1', name: 'Core', organizationId: 'org-1', _count: { boards: 3 } },
  { id: 'p2', name: 'Security', organizationId: 'org-1', keyStatus: 'pending' as const },
];

function renderList(props: Partial<React.ComponentProps<typeof ProjectList>> = {}) {
  const onSelect = vi.fn();
  const onCreate = vi.fn().mockResolvedValue(true);
  render(
    <ProjectList
      projects={projects}
      activeProjectId="p1"
      activeProjectCanvasCount={0}
      canCreate
      onSelect={onSelect}
      onCreate={onCreate}
      {...props}
    />,
  );
  return { onSelect, onCreate };
}

describe('ProjectList', () => {
  it('shows counts and marks a project whose key is pending', () => {
    renderList();
    expect(screen.getByText('03')).toBeInTheDocument();
    expect(screen.getByText('PENDING')).toBeInTheDocument();
  });

  it('says so when there are no projects', () => {
    renderList({ projects: [] });
    expect(screen.getByText('No projects created yet.')).toBeInTheDocument();
  });

  it('selects a project on click', () => {
    const { onSelect } = renderList();
    fireEvent.click(screen.getByRole('button', { name: /Security/ }));
    expect(onSelect).toHaveBeenCalledWith(projects[1]);
  });

  it('hides the new-project button without permission', () => {
    renderList({ canCreate: false });
    expect(screen.queryByTitle('New Project')).not.toBeInTheDocument();
  });

  it('closes and clears the form after a successful create', async () => {
    const { onCreate } = renderList();
    fireEvent.click(screen.getByTitle('New Project'));
    fireEvent.change(screen.getByPlaceholderText('Project name...'), {
      target: { value: '  Fresh  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => {
      expect(screen.queryByPlaceholderText('Project name...')).not.toBeInTheDocument();
    });
    expect(onCreate).toHaveBeenCalledWith('Fresh');
  });

  it('keeps the form and the typed name when the create fails', async () => {
    const onCreate = vi.fn().mockResolvedValue(false);
    renderList({ onCreate });
    fireEvent.click(screen.getByTitle('New Project'));
    fireEvent.change(screen.getByPlaceholderText('Project name...'), {
      target: { value: 'Fresh' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => expect(onCreate).toHaveBeenCalled());
    expect(screen.getByPlaceholderText('Project name...')).toHaveValue('Fresh');
  });
});
