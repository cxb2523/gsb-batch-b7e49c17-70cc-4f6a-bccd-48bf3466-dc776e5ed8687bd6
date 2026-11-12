import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { BoardHeader } from './BoardHeader';

vi.mock('@/components/UserNavDropdown', () => ({
  UserNavDropdown: () => <div data-testid="user-nav" />,
}));

function renderHeader(overrides: Partial<React.ComponentProps<typeof BoardHeader>> = {}) {
  const props: React.ComponentProps<typeof BoardHeader> = {
    workspaceRef: 'acme',
    workspaceName: 'acme corp',
    projectId: 'p1',
    projectName: 'core',
    title: 'Mesh',
    isViewer: false,
    syncState: 'saved',
    onRename: vi.fn(),
    onImportMermaid: vi.fn(),
    shareControl: <button>Share control</button>,
    ...overrides,
  };
  render(
    <MemoryRouter>
      <BoardHeader {...props} />
    </MemoryRouter>,
  );
  return props;
}

describe('BoardHeader', () => {
  it('shows capitalised breadcrumbs that link to the workspace and the project', () => {
    renderHeader();

    expect(screen.getByRole('link', { name: 'Acme corp' })).toHaveAttribute('href', '/w/acme');
    expect(screen.getByRole('link', { name: 'Core' })).toHaveAttribute(
      'href',
      '/w/acme?project=p1',
    );
    expect(screen.getByRole('link', { name: /Back/ })).toHaveAttribute('href', '/w/acme');
  });

  it('links the project crumb to the workspace until the board is known', () => {
    renderHeader({ projectId: undefined });

    expect(screen.getByRole('link', { name: 'Core' })).toHaveAttribute('href', '/w/acme');
  });

  it('shows the save state, the share control and the user menu', () => {
    renderHeader({ syncState: 'unsaved' });

    expect(screen.getByText('Unsaved')).toBeInTheDocument();
    expect(screen.getByText('Share control')).toBeInTheDocument();
    expect(screen.getByTestId('user-nav')).toBeInTheDocument();
  });

  it('opens the Mermaid import for an editor', () => {
    const { onImportMermaid } = renderHeader();

    fireEvent.click(screen.getByRole('button', { name: /Import Mermaid/ }));

    expect(onImportMermaid).toHaveBeenCalledTimes(1);
  });

  it('does not offer the Mermaid import to a viewer', () => {
    renderHeader({ isViewer: true });

    expect(screen.queryByRole('button', { name: /Import Mermaid/ })).not.toBeInTheDocument();
    expect(screen.getByText('Read-Only')).toBeInTheDocument();
  });
});
