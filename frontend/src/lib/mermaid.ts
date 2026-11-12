import type { BinaryFiles } from '@excalidraw/excalidraw/types';
import type { ExcalidrawElementSkeleton } from '@excalidraw/excalidraw/element/transform';

export interface MermaidConversionResult {
  elements: ExcalidrawElementSkeleton[];
  files?: BinaryFiles | undefined;
}

/**
 * Convert Mermaid diagram syntax (flowchart, sequence, class, git, etc.)
 * into native Excalidraw vector elements.
 */
export async function convertMermaidToExcalidraw(
  mermaidSyntax: string,
): Promise<MermaidConversionResult> {
  const trimmed = mermaidSyntax.trim();
  if (!trimmed) {
    throw new Error('Mermaid syntax cannot be empty');
  }

  // Loaded when someone imports a diagram, not when a canvas opens.
  const { parseMermaidToExcalidraw } = await import('@excalidraw/mermaid-to-excalidraw');
  const { elements, files } = await parseMermaidToExcalidraw(trimmed, {
    themeVariables: {
      fontSize: '16px',
    },
  });

  return { elements, files };
}
