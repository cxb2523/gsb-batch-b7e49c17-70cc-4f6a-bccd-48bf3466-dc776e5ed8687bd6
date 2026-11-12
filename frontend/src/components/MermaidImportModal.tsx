import { Modal } from '@/components/Modal';
import { useState } from 'react';
import type { BinaryFiles } from '@excalidraw/excalidraw/types';
import type { ExcalidrawElementSkeleton } from '@excalidraw/excalidraw/element/transform';
import { X, Code2, AlertCircle, Sparkles } from 'lucide-react';
import { convertMermaidToExcalidraw } from '@/lib/mermaid';
import { errorMessage } from '@/lib/errors';

interface MermaidImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (elements: ExcalidrawElementSkeleton[], files?: BinaryFiles) => void;
}

const TEMPLATES = [
  {
    name: 'Flowchart',
    syntax: `graph TD
    Client[Web Client] -->|HTTPS / WSS| Ingress[API Gateway]
    Ingress --> Auth[Better Auth Service]
    Ingress --> Boards[Boards & Canvas Service]
    Boards --> S3[(Encrypted S3 Storage)]
    Boards --> DB[(PostgreSQL Database)]`,
  },
  {
    name: 'Sequence',
    syntax: `sequenceDiagram
    autonumber
    Client->>API: POST /api/boards (Encrypted Key)
    API->>Database: Store Board Record
    Client->>S3: PUT /payload (AES-256 Encrypted Binary)
    S3-->>Client: 200 OK`,
  },
];

/** Far more than any diagram people write by hand; a larger paste would only stall the converter. */
const MERMAID_MAX_CHARS = 20_000;

export function MermaidImportModal({ isOpen, onClose, onImport }: MermaidImportModalProps) {
  const [code, setCode] = useState(() => {
    const template = TEMPLATES[0];
    if (!template) {
      throw new Error('The Mermaid template list is empty');
    }
    return template.syntax;
  });
  const [error, setError] = useState<string | null>(null);
  const [isConverting, setIsConverting] = useState(false);

  const handleConvertAndInsert = async () => {
    if (!code.trim()) return;
    if (code.length > MERMAID_MAX_CHARS) {
      setError(
        `The diagram is longer than ${MERMAID_MAX_CHARS.toLocaleString('en-US')} characters. Import it in smaller parts.`,
      );
      return;
    }
    setError(null);
    setIsConverting(true);
    try {
      const result = await convertMermaidToExcalidraw(code);
      onImport(result.elements, result.files);
      onClose();
    } catch (err) {
      console.error('Mermaid parsing error:', err);
      setError(errorMessage(err) ?? 'Failed to parse Mermaid diagram. Please verify syntax.');
    } finally {
      setIsConverting(false);
    }
  };

  return (
    <Modal
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      showCloseButton={false}
      className="max-w-xl w-full bg-white border border-border rounded-2xl shadow-2xl p-6 flex flex-col gap-4 font-mono"
    >
      <div className="flex items-center justify-between border-b border-border-subtle pb-3">
        <div className="flex items-center gap-2 text-ink font-bold text-sm tracking-tight">
          <Code2 className="w-4 h-4 text-brand" />
          <span>IMPORT MERMAID TO CANVAS</span>
        </div>
        <button
          onClick={onClose}
          className="p-1 text-ink-subtle hover:text-ink rounded-md transition-colors cursor-pointer"
          title="Close modal"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <p className="text-xs text-ink-muted leading-relaxed font-sans">
        Paste Mermaid flowchart or sequence syntax below to generate editable vector elements on
        your spatial canvas.
      </p>

      {error && (
        <div className="p-3 bg-danger-subtle border border-danger-border rounded-xl text-danger text-xs flex items-start gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-danger" />
          <span className="leading-snug">{error}</span>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between text-[11px] text-ink-muted">
          <span className="font-bold">TEMPLATES:</span>
          <div className="flex items-center gap-1.5">
            {TEMPLATES.map((tmpl) => (
              <button
                key={tmpl.name}
                type="button"
                onClick={() => setCode(tmpl.syntax)}
                className="px-2.5 py-1 bg-surface-2 hover:bg-surface-3 text-ink text-[10px] uppercase font-semibold rounded-md border border-border transition-colors cursor-pointer"
              >
                {tmpl.name}
              </button>
            ))}
          </div>
        </div>
        <textarea
          value={code}
          onChange={(e) => setCode(e.target.value)}
          rows={9}
          className="w-full p-3 bg-paper border border-border rounded-xl text-xs font-mono text-ink outline-none focus:bg-white focus:border-ink resize-none transition-colors"
          placeholder="graph TD..."
          spellCheck={false}
        />
      </div>

      <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-border-subtle">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 border border-border text-ink hover:bg-paper rounded-lg text-xs font-semibold uppercase transition-colors cursor-pointer shadow-2xs"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleConvertAndInsert}
          disabled={isConverting || !code.trim()}
          className="px-4 py-2 bg-ink hover:bg-ink-hover text-white rounded-lg text-xs font-semibold uppercase flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50 shadow-sm"
        >
          <Sparkles className="w-3.5 h-3.5 text-success-bright" />
          <span>{isConverting ? 'Converting...' : 'Insert into Canvas'}</span>
        </button>
      </div>
    </Modal>
  );
}
