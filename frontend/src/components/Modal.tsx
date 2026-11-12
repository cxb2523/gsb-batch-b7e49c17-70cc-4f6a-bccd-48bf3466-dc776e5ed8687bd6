import * as React from 'react';
import { useEffect, useRef, useId } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: React.ReactNode | undefined;
  titleId?: string | undefined;
  description?: React.ReactNode | undefined;
  descriptionId?: string | undefined;
  children: React.ReactNode;
  className?: string | undefined;
  showCloseButton?: boolean | undefined;
}

export function Modal({
  open,
  onOpenChange,
  title,
  titleId,
  description,
  descriptionId,
  children,
  className,
  showCloseButton = true,
}: ModalProps) {
  const generatedTitleId = useId();
  const generatedDescId = useId();
  const effectiveTitleId = titleId || (title ? generatedTitleId : undefined);
  const effectiveDescId = descriptionId || (description ? generatedDescId : undefined);

  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  // Callers pass inline handlers; the effect below must not re-run (and steal focus) when one changes.
  const onOpenChangeRef = useRef(onOpenChange);
  useEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  });

  // Focus trap & focus return
  useEffect(() => {
    if (!open) return undefined;

    previouslyFocusedRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const container = dialogRef.current;
    if (container) {
      // Find first focusable element
      const focusable = container.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length > 0) {
        focusable[0]?.focus();
      } else {
        container.focus();
      }
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onOpenChangeRef.current(false);
        return;
      }

      if (e.key === 'Tab' && dialogRef.current) {
        const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        if (focusables.length === 0) return;

        const first = focusables[0];
        const last = focusables[focusables.length - 1];

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      previouslyFocusedRef.current?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/40 backdrop-blur-xs animate-in fade-in-0 duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onOpenChange(false);
        }
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={effectiveTitleId}
        aria-describedby={effectiveDescId}
        tabIndex={-1}
        className={cn(
          'relative w-full max-w-md bg-white border border-border rounded-2xl shadow-xl overflow-hidden focus:outline-none animate-in zoom-in-95 duration-150',
          className,
        )}
      >
        {showCloseButton && (
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="absolute top-4 right-4 p-1 rounded-lg text-ink-subtle hover:text-ink hover:bg-surface-2 transition-colors cursor-pointer"
            aria-label="Close dialog"
          >
            <X className="w-4 h-4" />
          </button>
        )}

        {title && (
          <div className="px-6 pt-6 pb-2">
            <h3
              id={effectiveTitleId}
              className="text-base font-bold text-ink tracking-tight font-sans"
            >
              {title}
            </h3>
            {description && (
              <div id={effectiveDescId} className="text-xs text-ink-muted mt-1 leading-relaxed">
                {description}
              </div>
            )}
          </div>
        )}

        {children}
      </div>
    </div>,
    document.body,
  );
}
