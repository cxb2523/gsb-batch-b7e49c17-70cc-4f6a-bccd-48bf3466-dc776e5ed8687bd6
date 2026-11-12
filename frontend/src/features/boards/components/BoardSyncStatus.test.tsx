import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BoardSyncStatus } from './BoardSyncStatus';
import type { SyncState } from '../hooks/useBoardSave';

describe('BoardSyncStatus', () => {
  const labels: Array<[SyncState, string]> = [
    ['saving', 'Saving...'],
    ['saved', 'Saved'],
    ['unsaved', 'Unsaved'],
    ['error', 'Save Error'],
    ['needs-sign-in', 'Sign in to save'],
  ];

  it.each(labels)('says %s as "%s" for an editor', (state, label) => {
    render(<BoardSyncStatus isViewer={false} syncState={state} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('shows a read-only badge instead of a save state for a viewer', () => {
    render(<BoardSyncStatus isViewer syncState="error" />);

    expect(screen.getByText('Read-Only')).toBeInTheDocument();
    expect(screen.queryByText('Save Error')).not.toBeInTheDocument();
  });
});
