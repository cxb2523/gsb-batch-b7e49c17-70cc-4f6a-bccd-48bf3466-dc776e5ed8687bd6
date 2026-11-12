import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { Landing } from './Landing';

describe('Landing Page Component (Soft Editorial Redesign)', () => {
  const renderLanding = () =>
    render(
      <BrowserRouter>
        <Landing />
      </BrowserRouter>,
    );

  it('renders clean header with brand and left-aligned navigation', () => {
    renderLanding();
    expect(screen.getByText('CanvHQ')).toBeInTheDocument();
    expect(screen.getByText('Overview')).toBeInTheDocument();
    expect(screen.getAllByText('Documentation').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Security').length).toBeGreaterThan(0);
    expect(screen.getByText('Log in')).toBeInTheDocument();
    expect(screen.getAllByText('Get Started').length).toBeGreaterThan(0);

    // Verify unauthenticated visitor does NOT see internal workspace elements
    expect(screen.queryByText('Members')).not.toBeInTheDocument();
    expect(screen.queryByText('New Workspace')).not.toBeInTheDocument();
  });

  it('renders primary hero headline and call to action buttons', () => {
    renderLanding();
    expect(screen.getByRole('heading', { name: /Make space for/i })).toBeInTheDocument();
    expect(screen.getByText(/big-picture thinking/i)).toBeInTheDocument();
    expect(screen.getByText(/An open workspace for diagrams, architecture/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Explore your workspace/i).length).toBeGreaterThan(0);

    const repoLink = screen.getByText(/View GitHub Repo/i).closest('a');
    expect(repoLink).toHaveAttribute('href', 'https://github.com/qaribhaider/canvhq');
  });

  it('renders Excalidraw toolbar and diagram view with CANVHQ / BOARD 01 title', () => {
    renderLanding();

    // Header title verification
    expect(screen.getAllByText('CANVHQ').length).toBeGreaterThan(0);
    expect(screen.getByText('BOARD 01')).toBeInTheDocument();
    expect(screen.queryByText('· SYSTEM ARCHITECTURE')).not.toBeInTheDocument();

    // Standard Excalidraw toolbar tools
    expect(screen.getByRole('toolbar', { name: /Excalidraw tools/i })).toBeInTheDocument();
    expect(screen.getByLabelText('Selection')).toBeInTheDocument();
    expect(screen.getByLabelText('Rectangle')).toBeInTheDocument();
    expect(screen.getByLabelText('Diamond')).toBeInTheDocument();
    expect(screen.getByLabelText('Ellipse')).toBeInTheDocument();
    expect(screen.getByLabelText('Arrow')).toBeInTheDocument();

    // Clicking a tool sets it as active
    const rectTool = screen.getByLabelText('Rectangle');
    fireEvent.click(rectTool);
    expect(rectTool.className).toContain('bg-avatar-blue-bg');

    // Architecture diagram nodes and note
    expect(screen.getByText('CLIENT')).toBeInTheDocument();
    expect(screen.getByText('API LAYER')).toBeInTheDocument();
    expect(screen.getByText('STORAGE')).toBeInTheDocument();
    expect(screen.getByText('Room to think.')).toBeInTheDocument();
  });

  it('renders feature pillars and editorial cards', () => {
    renderLanding();
    expect(screen.getByText('A canvas that stays out of the way')).toBeInTheDocument();
    expect(screen.getByText('Your workspace, your rules')).toBeInTheDocument();
    expect(screen.getByText('Open by nature')).toBeInTheDocument();
    expect(screen.getByText('Everything has room to breathe.')).toBeInTheDocument();
    expect(screen.getByText('Projects with purpose')).toBeInTheDocument();
    expect(screen.getByText('Think visually')).toBeInTheDocument();
    expect(screen.getByText('Privacy stays foundational')).toBeInTheDocument();
  });

  it('renders open source and license micro-copy in footer without dead links', () => {
    renderLanding();
    expect(screen.getByText('Self-hostable')).toBeInTheDocument();
    expect(screen.getByText('Open source')).toBeInTheDocument();
    expect(screen.getAllByText(/Apache 2.0 Licensed/i).length).toBeGreaterThan(0);
    expect(
      screen.getByText(new RegExp(`© ${new Date().getFullYear()} CanvHQ`)),
    ).toBeInTheDocument();

    // Verify non-functional placeholders are removed from footer
    expect(screen.queryByText('System Status')).not.toBeInTheDocument();
  });
});
