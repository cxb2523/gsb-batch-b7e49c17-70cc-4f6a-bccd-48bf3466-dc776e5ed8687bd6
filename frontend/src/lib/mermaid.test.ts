import { describe, it, expect, beforeAll } from 'vitest';
import { convertMermaidToExcalidraw } from './mermaid';

/** jsdom does not implement SVG getBBox, which mermaid uses to measure diagram elements. */
function installGetBBoxShim() {
  const prototype = window.SVGElement.prototype;
  if ('getBBox' in prototype) return;
  const box: DOMRect = {
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    bottom: 50,
    left: 0,
    right: 100,
    top: 0,
    toJSON: () => ({}),
  };
  Object.defineProperty(prototype, 'getBBox', { value: () => box, configurable: true });
}

describe('mermaid conversion module', () => {
  beforeAll(installGetBBoxShim);

  it('converts valid mermaid flowchart syntax to Excalidraw elements', async () => {
    const validFlowchart = `
      flowchart TD
      A[Start] --> B[Process]
      B --> C[End]
    `;

    const result = await convertMermaidToExcalidraw(validFlowchart);

    expect(result).toBeDefined();
    expect(result.elements).toBeDefined();
    expect(Array.isArray(result.elements)).toBe(true);
    expect(result.elements.length).toBeGreaterThan(0);
  });

  it('converts valid mermaid sequence diagram syntax', async () => {
    const validSequence = `
      sequenceDiagram
      Alice->>Bob: Hello
      Bob-->>Alice: Hi
    `;

    const result = await convertMermaidToExcalidraw(validSequence);

    expect(result).toBeDefined();
    expect(Array.isArray(result.elements)).toBe(true);
    expect(result.elements.length).toBeGreaterThan(0);
  });

  it('throws an error when input is an empty string', async () => {
    await expect(convertMermaidToExcalidraw('')).rejects.toThrow('Mermaid syntax cannot be empty');
  });

  it('throws an error when input is whitespace only', async () => {
    await expect(convertMermaidToExcalidraw('   \n\t  \r\n  ')).rejects.toThrow(
      'Mermaid syntax cannot be empty',
    );
  });

  it('propagates an error when mermaid syntax is invalid', async () => {
    const invalidSyntax = 'NOT_A_VALID_MERMAID_DIAGRAM_AT_ALL ::: !!!';
    await expect(convertMermaidToExcalidraw(invalidSyntax)).rejects.toThrow();
  });
});
