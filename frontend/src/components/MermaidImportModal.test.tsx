import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { BinaryFileData, BinaryFiles } from '@excalidraw/excalidraw/types';
import { MermaidImportModal } from './MermaidImportModal';
import * as mermaidLib from '@/lib/mermaid';

function isBinaryFileData(value: unknown): value is BinaryFileData {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'dataURL' in value &&
    'mimeType' in value &&
    'created' in value
  );
}

describe('MermaidImportModal Component', () => {
  const mockOnClose = vi.fn();
  const mockOnImport = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not render when isOpen is false', () => {
    render(<MermaidImportModal isOpen={false} onClose={mockOnClose} onImport={mockOnImport} />);
    expect(screen.queryByText(/IMPORT MERMAID/i)).not.toBeInTheDocument();
  });

  it('renders correctly with starter template when opened', () => {
    render(<MermaidImportModal isOpen={true} onClose={mockOnClose} onImport={mockOnImport} />);
    expect(screen.getByText('IMPORT MERMAID TO CANVAS')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Insert into Canvas/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Flowchart/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sequence/i })).toBeInTheDocument();
  });

  it('loads predefined templates upon clicking template pills', () => {
    render(<MermaidImportModal isOpen={true} onClose={mockOnClose} onImport={mockOnImport} />);
    const seqButton = screen.getByRole('button', { name: /Sequence/i });
    fireEvent.click(seqButton);

    const textarea = screen.getByRole<HTMLTextAreaElement>('textbox');
    expect(textarea.value).toContain('sequenceDiagram');
  });

  it('refuses a diagram far larger than anyone writes by hand, and does not try to convert it', async () => {
    const convert = vi.spyOn(mermaidLib, 'convertMermaidToExcalidraw');
    render(<MermaidImportModal isOpen={true} onClose={mockOnClose} onImport={mockOnImport} />);

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: `graph TD\n${'A --> B\n'.repeat(3000)}` },
    });
    fireEvent.click(screen.getByRole('button', { name: /Insert into Canvas/i }));

    expect(
      await screen.findByText(/longer than 20,000 characters\. Import it in smaller parts\./),
    ).toBeInTheDocument();
    expect(convert).not.toHaveBeenCalled();
    expect(mockOnImport).not.toHaveBeenCalled();
  });

  it('calls convertMermaidToExcalidraw and triggers onImport on valid syntax', async () => {
    vi.spyOn(mermaidLib, 'convertMermaidToExcalidraw').mockResolvedValue({
      elements: [{ id: 'elem-1', type: 'rectangle', x: 0, y: 0 }],
    });

    render(<MermaidImportModal isOpen={true} onClose={mockOnClose} onImport={mockOnImport} />);

    const insertBtn = screen.getByRole('button', { name: /Insert into Canvas/i });
    fireEvent.click(insertBtn);

    await waitFor(() => {
      expect(mermaidLib.convertMermaidToExcalidraw).toHaveBeenCalled();
      expect(mockOnImport).toHaveBeenCalledWith(
        [{ id: 'elem-1', type: 'rectangle', x: 0, y: 0 }],
        undefined,
      );
      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  it('passes files produced by Mermaid to onImport', async () => {
    const mockFiles: BinaryFiles = {};
    const entry = {
      id: 'file-1',
      dataURL: 'data:image/png;base64,abc',
      mimeType: 'image/png',
      created: 123,
    };
    if (isBinaryFileData(entry)) {
      mockFiles['file-1'] = entry;
    }

    vi.spyOn(mermaidLib, 'convertMermaidToExcalidraw').mockResolvedValue({
      elements: [{ id: 'elem-1', type: 'rectangle', x: 0, y: 0 }],
      files: mockFiles,
    });

    render(<MermaidImportModal isOpen={true} onClose={mockOnClose} onImport={mockOnImport} />);

    const insertBtn = screen.getByRole('button', { name: /Insert into Canvas/i });
    fireEvent.click(insertBtn);

    await waitFor(() => {
      expect(mockOnImport).toHaveBeenCalledWith(
        [{ id: 'elem-1', type: 'rectangle', x: 0, y: 0 }],
        mockFiles,
      );
      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  it('displays syntax error banner when conversion fails', async () => {
    vi.spyOn(mermaidLib, 'convertMermaidToExcalidraw').mockRejectedValue(
      new Error('Parse error on line 2: Unexpected token'),
    );

    render(<MermaidImportModal isOpen={true} onClose={mockOnClose} onImport={mockOnImport} />);

    const insertBtn = screen.getByRole('button', { name: /Insert into Canvas/i });
    fireEvent.click(insertBtn);

    await waitFor(() => {
      expect(screen.getByText(/Parse error on line 2/i)).toBeInTheDocument();
      expect(mockOnImport).not.toHaveBeenCalled();
    });
  });
});
