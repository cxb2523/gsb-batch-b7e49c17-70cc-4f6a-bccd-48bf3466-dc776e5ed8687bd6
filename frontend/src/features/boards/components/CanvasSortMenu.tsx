import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

const CANVAS_SORT_OPTIONS: { value: string; label: string }[] = [
  { value: 'updated-desc', label: 'Recently updated' },
  { value: 'updated-asc', label: 'Oldest updated' },
  { value: 'created-desc', label: 'Newest created' },
  { value: 'created-asc', label: 'Oldest created' },
  { value: 'title-asc', label: 'Title (A–Z)' },
  { value: 'title-desc', label: 'Title (Z–A)' },
];

export function CanvasSortMenu({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const closeOnOutsideClick = (e: MouseEvent) => {
      if (e.target instanceof Node && !containerRef.current?.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    return () => document.removeEventListener('mousedown', closeOnOutsideClick);
  }, []);

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex items-center gap-2 bg-white hover:bg-paper border border-border hover:border-border-strong h-8 px-3 rounded-lg text-xs font-semibold text-ink shadow-2xs transition-colors cursor-pointer group"
        aria-expanded={isOpen}
      >
        <span className="text-ink-muted text-xs">↕</span>
        <span>
          {CANVAS_SORT_OPTIONS.find((opt) => opt.value === value)?.label || 'Recently updated'}
        </span>
        <ChevronDown
          className={`w-3.5 h-3.5 text-ink-subtle group-hover:text-ink transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {/* Hidden native select for accessibility and testing compatibility */}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Sort"
        className="sr-only"
        tabIndex={-1}
      >
        {CANVAS_SORT_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      {isOpen && (
        <div className="absolute right-0 top-full mt-1.5 w-48 bg-white border border-border rounded-xl shadow-xl py-1.5 z-30 font-sans text-xs">
          <div className="px-3 py-1 font-mono text-[10px] uppercase text-ink-muted font-semibold tracking-wider">
            Sort canvases
          </div>
          <div className="flex flex-col">
            {CANVAS_SORT_OPTIONS.map((opt) => {
              const isSelected = opt.value === value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    onChange(opt.value);
                    setIsOpen(false);
                  }}
                  className={`w-full px-3 py-2 text-left flex items-center justify-between hover:bg-paper transition-colors cursor-pointer ${
                    isSelected ? 'bg-brand-subtle/70 text-ink font-semibold' : 'text-ink-prose'
                  }`}
                >
                  <span>{opt.label}</span>
                  {isSelected && <span className="text-brand text-xs font-bold">✓</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
