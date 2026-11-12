import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PublicBoardView } from './PublicBoardView';
import { generateSymmetricKey, exportKeyToHash } from '@/lib/crypto';
import { sealBoardPayload } from '@/lib/crypto-format';
import { errorResponse, jsonResponse, networkFailure } from '@/test/http';

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

interface MockExcalidrawProps {
  UIOptions?: { canvasActions?: Record<string, boolean> };
  viewModeEnabled?: boolean;
  zenModeEnabled?: boolean;
  initialData?: { elements?: Array<{ id: string }> };
  children?: React.ReactNode;
}

vi.mock('@excalidraw/excalidraw', () => ({
  Excalidraw: ({
    UIOptions,
    viewModeEnabled,
    zenModeEnabled,
    initialData,
    children,
  }: MockExcalidrawProps) => (
    <div data-testid="mock-public-excalidraw">
      <span data-testid="view-mode-opt">{String(viewModeEnabled)}</span>
      <span data-testid="zen-mode-opt">{String(zenModeEnabled)}</span>
      <span data-testid="clear-canvas-opt">{String(UIOptions?.canvasActions?.clearCanvas)}</span>
      <span data-testid="change-bg-opt">
        {String(UIOptions?.canvasActions?.changeViewBackgroundColor)}
      </span>
      <span data-testid="save-image-opt">{String(UIOptions?.canvasActions?.saveAsImage)}</span>
      <span data-testid="element-ids">
        {(initialData?.elements ?? []).map((element) => element.id).join(',')}
      </span>
      {children}
    </div>
  ),
}));

const sharedBoard = (overrides: Record<string, unknown> = {}) => ({
  id: 'b1',
  title: 'Public Architecture Overview',
  isPublic: true,
  hasPayload: false,
  ...overrides,
});

describe('PublicBoardView Component', () => {
  let validKeyHash: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    const key = await generateSymmetricKey();
    validKeyHash = await exportKeyToHash(key);

    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.includes('/api/public/boards/tok-valid')) return jsonResponse(sharedBoard());
      if (url.includes('/api/public/boards/tok-revoked')) {
        return errorResponse(404, 'NOT_FOUND', 'This link was revoked');
      }
      return errorResponse(500, 'INTERNAL', 'Unexpected request');
    });
  });

  const renderPublicView = (route: string) => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[route]}>
          <Routes>
            <Route path="/share/:token" element={<PublicBoardView />} />
            <Route path="/" element={<div>Home</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  };

  it('renders strictly read-only Excalidraw canvas when valid share token and key are provided', async () => {
    renderPublicView(`/share/tok-valid#key=${validKeyHash}`);

    await waitFor(() => {
      expect(screen.getByTestId('mock-public-excalidraw')).toBeInTheDocument();
      expect(screen.getByText('Public Architecture Overview')).toBeInTheDocument();
    });

    // Verify strictly enforced viewMode
    expect(screen.getByTestId('view-mode-opt')).toHaveTextContent('true');
    expect(screen.getByTestId('zen-mode-opt')).toHaveTextContent('false');
    expect(screen.getByTestId('clear-canvas-opt')).toHaveTextContent('false');
    expect(screen.getByTestId('change-bg-opt')).toHaveTextContent('false');
    expect(screen.getByTestId('save-image-opt')).toHaveTextContent('true');

    // Header checks
    expect(screen.getByText('PUBLIC VIEW')).toBeInTheDocument();
    expect(screen.getByText('READ-ONLY VIEW')).toBeInTheDocument();

    // Isolation check: No workspace navigation or edit chrome exists
    expect(screen.queryByText('Back')).not.toBeInTheDocument();
    expect(screen.queryByText('Share Link')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/User profile/i)).not.toBeInTheDocument();
    expect(screen.queryByTitle(/Click to rename/i)).not.toBeInTheDocument();
  });

  it('decrypts the stored payload with the key from the link fragment', async () => {
    const key = await generateSymmetricKey();
    const hash = await exportKeyToHash(key);
    const ciphertext = await sealBoardPayload(
      key,
      { elements: [{ id: 'shared-rectangle' }] },
      { boardId: 'b1', keyVersion: 1, revision: 1 },
    );
    global.fetch = vi.fn(async (input: RequestInfo | URL) =>
      requestUrl(input).includes('/payload')
        ? new Response(ciphertext, { status: 200 })
        : jsonResponse(sharedBoard({ hasPayload: true, keyVersion: 1 })),
    );

    renderPublicView(`/share/tok-valid#key=${hash}`);

    await waitFor(() => {
      expect(screen.getByTestId('element-ids')).toHaveTextContent('shared-rectangle');
    });
  });

  it('keeps the key in the fragment: no request carries it', async () => {
    renderPublicView(`/share/tok-valid#key=${validKeyHash}`);

    await waitFor(() => {
      expect(screen.getByTestId('mock-public-excalidraw')).toBeInTheDocument();
    });
    for (const [url, init] of vi.mocked(global.fetch).mock.calls) {
      expect(requestUrl(url)).not.toContain(validKeyHash);
      expect(JSON.stringify(init ?? {})).not.toContain(validKeyHash);
    }
  });

  it('displays access restricted error when token is invalid or revoked (404)', async () => {
    renderPublicView(`/share/tok-revoked#key=${validKeyHash}`);

    await waitFor(() => {
      expect(screen.getByText('Access Restricted')).toBeInTheDocument();
      expect(screen.getByText(/public link has been revoked/i)).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /Go to CanvHQ Home/i })).toBeInTheDocument();
    });

    expect(screen.queryByTestId('mock-public-excalidraw')).not.toBeInTheDocument();
  });

  it('offers a retry when the canvas cannot be fetched, and shows it once the server answers', async () => {
    let attempts = 0;
    global.fetch = vi.fn(async () => {
      attempts += 1;
      return attempts === 1
        ? errorResponse(503, 'UNAVAILABLE', 'Try later')
        : jsonResponse(sharedBoard());
    });

    renderPublicView(`/share/tok-valid#key=${validKeyHash}`);

    await waitFor(() => {
      expect(screen.getByText('Unable to load public canvas')).toBeInTheDocument();
    });
    expect(screen.queryByText('Access Restricted')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Try again/i }));

    await waitFor(() => {
      expect(screen.getByTestId('mock-public-excalidraw')).toBeInTheDocument();
    });
  });

  it('offers a retry when the network is down', async () => {
    global.fetch = vi.fn(() => networkFailure());

    renderPublicView(`/share/tok-valid#key=${validKeyHash}`);

    await waitFor(() => {
      expect(screen.getByText('Unable to load public canvas')).toBeInTheDocument();
    });
  });

  it('offers a retry when the payload cannot be fetched', async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) =>
      requestUrl(input).includes('/payload')
        ? errorResponse(500, 'INTERNAL', 'Storage is down')
        : jsonResponse(sharedBoard({ hasPayload: true })),
    );

    renderPublicView(`/share/tok-valid#key=${validKeyHash}`);

    await waitFor(() => {
      expect(screen.getByText('Unable to load public canvas')).toBeInTheDocument();
    });
    expect(screen.queryByText('Decryption Key Required')).not.toBeInTheDocument();
  });

  it('prompts user for decryption key when hash key is missing', async () => {
    renderPublicView('/share/tok-valid');

    await waitFor(() => {
      expect(screen.getByText('Decryption Key Required')).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/Paste #key=\.\.\./i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Decrypt Canvas/i })).toBeInTheDocument();
    });

    // Provide the key manually
    const input = screen.getByPlaceholderText(/Paste #key=\.\.\./i);
    fireEvent.change(input, { target: { value: `#key=${validKeyHash}` } });
    fireEvent.click(screen.getByRole('button', { name: /Decrypt Canvas/i }));

    await waitFor(() => {
      expect(screen.getByTestId('mock-public-excalidraw')).toBeInTheDocument();
      expect(screen.queryByText('Decryption Key Required')).not.toBeInTheDocument();
    });
  });

  it('says so when the key in the link is malformed, and accepts a pasted one', async () => {
    renderPublicView('/share/tok-valid#key=not-a-real-key');

    await waitFor(() => {
      expect(screen.getByText('Invalid encryption key in URL hash fragment.')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('mock-public-excalidraw')).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/Paste #key=\.\.\./i), {
      target: { value: validKeyHash },
    });
    fireEvent.click(screen.getByRole('button', { name: /Decrypt Canvas/i }));

    await waitFor(() => {
      expect(screen.getByTestId('mock-public-excalidraw')).toBeInTheDocument();
    });
  });

  it('says so when a pasted key is the wrong length', async () => {
    renderPublicView('/share/tok-valid');

    await waitFor(() => {
      expect(screen.getByText('Decryption Key Required')).toBeInTheDocument();
    });
    fireEvent.change(screen.getByPlaceholderText(/Paste #key=\.\.\./i), {
      target: { value: 'AAAA' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Decrypt Canvas/i }));

    await waitFor(() => {
      expect(screen.getByText(/Invalid key length/i)).toBeInTheDocument();
    });
    expect(screen.queryByTestId('mock-public-excalidraw')).not.toBeInTheDocument();
  });

  it('says so when the key does not open the canvas', async () => {
    const otherKey = await generateSymmetricKey();
    const ciphertext = await sealBoardPayload(
      otherKey,
      { elements: [{ id: 'secret' }] },
      { boardId: 'b1', keyVersion: 1, revision: 1 },
    );
    global.fetch = vi.fn(async (input: RequestInfo | URL) =>
      requestUrl(input).includes('/payload')
        ? new Response(ciphertext, { status: 200 })
        : jsonResponse(sharedBoard({ hasPayload: true, keyVersion: 1 })),
    );

    renderPublicView(`/share/tok-valid#key=${validKeyHash}`);

    await waitFor(() => {
      expect(screen.getByText(/Decryption failed/i)).toBeInTheDocument();
    });
    expect(screen.queryByTestId('mock-public-excalidraw')).not.toBeInTheDocument();
  });
});
