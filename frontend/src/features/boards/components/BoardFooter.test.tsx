import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { BoardFooter } from './BoardFooter';

describe('BoardFooter', () => {
  it('describes an editing session', () => {
    render(
      <BrowserRouter>
        <BoardFooter isViewer={false} accessRole="editor" isGridOn />
      </BrowserRouter>,
    );

    expect(screen.getByText('MODE: EDITING (READY)')).toBeInTheDocument();
    expect(screen.getByText('KEY: ENCRYPTED')).toBeInTheDocument();
    expect(screen.getByText('AUTOSAVE: ON STROKE END')).toBeInTheDocument();
    expect(screen.getByText('GRID: 20PX SNAP')).toBeInTheDocument();
  });

  it('says why a project viewer is read-only', () => {
    render(
      <BrowserRouter>
        <BoardFooter isViewer accessRole="viewer" isGridOn={false} />
      </BrowserRouter>,
    );

    expect(screen.getByText('MODE: VIEWER (READ-ONLY)')).toBeInTheDocument();
    expect(screen.getByText('ACCESS: PROJECT VIEWER')).toBeInTheDocument();
    expect(screen.getByText('AUTOSAVE: DISABLED (READ-ONLY)')).toBeInTheDocument();
    expect(screen.getByText('GRID: OFF')).toBeInTheDocument();
  });

  it('calls anyone else who cannot edit a workspace viewer', () => {
    render(
      <BrowserRouter>
        <BoardFooter isViewer accessRole={null} isGridOn />
      </BrowserRouter>,
    );

    expect(screen.getByText('ACCESS: WORKSPACE VIEWER')).toBeInTheDocument();
  });
});
