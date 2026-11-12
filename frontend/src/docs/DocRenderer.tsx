import React, { useMemo, useState } from 'react';
import { marked, type MarkedOptions } from 'marked';
import { Check, Copy } from 'lucide-react';
import type { TocItem } from './types';

interface DocRendererProps {
  markdown: string;
  onHeadingsExtracted?: (headings: TocItem[]) => void;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

function parsedMarkdown(source: string, renderer?: MarkedOptions['renderer']): string {
  const html = renderer
    ? marked.parse(source, { renderer, gfm: true, async: false })
    : marked.parse(source, { async: false });
  if (typeof html !== 'string') {
    throw new Error('Marked returned a promise in synchronous mode');
  }
  return html;
}

export function DocRenderer({ markdown, onHeadingsExtracted }: DocRendererProps) {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const { html, codeBlocks, headings } = useMemo(() => {
    const headings: TocItem[] = [];
    const blocks: { code: string; lang: string }[] = [];

    // Custom renderer for marked
    const renderer = new marked.Renderer();

    // Headings with IDs
    renderer.heading = ({ tokens, depth }) => {
      const text = tokens.map((t) => ('text' in t ? t.text : '')).join('');
      const id = slugify(text);
      if (depth === 2 || depth === 3) {
        headings.push({ id, text, level: depth });
      }
      if (depth === 1) {
        // Skip H1 in markdown body because Docs.tsx renders the main page H1 title
        return '';
      }
      return `<h${depth} id="${id}" class="doc-heading-${depth} group flex items-center scroll-mt-20">
        <span>${text}</span>
        <a href="#${id}" class="opacity-0 group-hover:opacity-100 ml-2 text-slate-400 hover:text-slate-600 transition-opacity font-mono text-sm" aria-label="Link to section">#</a>
      </h${depth}>`;
    };

    // Code blocks with placeholders
    renderer.code = ({ text, lang }) => {
      const blockIndex = blocks.length;
      blocks.push({ code: text, lang: lang || 'text' });
      return `<div data-code-block="${blockIndex}"></div>`;
    };

    // Process callouts in markdown text prior to parsing
    const calloutProcessed = markdown.replace(
      />\s*\[!(NOTE|TIP|WARNING|SECURITY|IMPORTANT)\]\s*[\r\n]+((?:>.*[\r\n]*)*)/gi,
      (_match, type, content) => {
        const cleanedContent = content
          .split(/\r?\n/)
          .map((line: string) => line.replace(/^>\s?/, ''))
          .join('\n')
          .trim();
        const calloutType = type.toUpperCase();
        return `\n<div class="doc-callout doc-callout-${calloutType.toLowerCase()} my-5 p-4 border-l-2 bg-slate-50/80 text-xs" data-callout="${calloutType}">
<div class="font-mono text-[11px] font-bold uppercase tracking-wider mb-1.5 flex items-center gap-1.5 callout-title">${calloutType}</div>
<div class="callout-body text-slate-600 leading-relaxed">${parsedMarkdown(cleanedContent)}</div>
</div>\n\n`;
      },
    );

    const rawHtml = parsedMarkdown(calloutProcessed, renderer);

    return { html: rawHtml, codeBlocks: blocks, headings };
  }, [markdown]);

  React.useEffect(() => {
    if (onHeadingsExtracted) {
      onHeadingsExtracted(headings);
    }
  }, [headings, onHeadingsExtracted]);

  const handleCopy = (code: string, index: number) => {
    void navigator.clipboard.writeText(code);
    setCopiedIndex(index);
    setTimeout(() => {
      setCopiedIndex((prev) => (prev === index ? null : prev));
    }, 2000);
  };

  // Split HTML by code block placeholders and render code blocks with React
  const segments = useMemo(() => {
    const parts = html.split(/<div data-code-block="(\d+)"><\/div>/g);
    return parts;
  }, [html]);

  return (
    <div className="doc-content prose prose-slate max-w-none text-ink-prose text-[13px] leading-relaxed">
      {segments.map((segment, index) => {
        // If odd, it's the blockIndex from regex capture group
        if (index % 2 === 1) {
          const blockIndex = parseInt(segment, 10);
          const block = codeBlocks[blockIndex];
          if (!block) return null;
          const isCopied = copiedIndex === blockIndex;

          return (
            <div
              key={`block-${blockIndex}`}
              className="my-6 border border-border bg-code-bg text-slate-200 font-mono text-[11px] rounded-xl shadow-xs overflow-hidden"
            >
              {/* Header Bar */}
              <div className="flex items-center justify-between px-3.5 py-2 bg-ink border-b border-code-border text-ink-subtle text-[10px]">
                <span className="font-semibold uppercase tracking-wider text-border-strong">
                  {block.lang}
                </span>
                <button
                  type="button"
                  onClick={() => handleCopy(block.code, blockIndex)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-0.5 hover:bg-ink-hover text-border-strong hover:text-white rounded transition-colors cursor-pointer"
                  title="Copy code to clipboard"
                  aria-label="Copy code to clipboard"
                >
                  {isCopied ? (
                    <>
                      <Check className="w-3 h-3 text-emerald-400" />
                      <span className="text-emerald-400 font-medium">Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>

              {/* Code Pre Container */}
              <pre className="p-4 overflow-x-auto font-mono text-[11px] leading-relaxed m-0 bg-transparent text-slate-200">
                <code>{block.code}</code>
              </pre>
            </div>
          );
        }

        return (
          <div
            key={`html-${index}`}
            dangerouslySetInnerHTML={{ __html: segment }}
            className="doc-html-section"
          />
        );
      })}
    </div>
  );
}
