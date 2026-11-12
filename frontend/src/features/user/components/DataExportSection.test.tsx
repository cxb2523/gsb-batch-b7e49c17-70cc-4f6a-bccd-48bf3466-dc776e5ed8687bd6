import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { DataExportSection } from './DataExportSection';
import { errorResponse } from '@/test/http';
import { stubFetchRoutes } from '@/test/route-fetch';
import { renderWithProviders } from '@/test/render-with-providers';

describe('DataExportSection', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the server error and stays usable when the export fails', async () => {
    stubFetchRoutes({
      'GET /api/user/export-data': () => errorResponse(500, 'INTERNAL', 'Export is unavailable'),
    });
    renderWithProviders(<DataExportSection />);

    fireEvent.click(screen.getByRole('button', { name: /Export Personal Data/i }));

    expect(await screen.findByText('Export is unavailable')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Export Personal Data/i })).toBeEnabled();
  });
});
