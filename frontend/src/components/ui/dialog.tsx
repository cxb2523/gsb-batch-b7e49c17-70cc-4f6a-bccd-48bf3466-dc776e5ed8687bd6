import * as React from 'react';
import { cn } from '@/lib/utils';
import { Modal } from '@/components/Modal';

// Standard shadcn Dialog primitives built on Modal
export interface DialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}

const DialogContext = React.createContext<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
}>({
  open: false,
  onOpenChange: () => {},
});

const NOOP = () => {};

export function Dialog({ open = false, onOpenChange = NOOP, children }: DialogProps) {
  const contextValue = React.useMemo(() => ({ open, onOpenChange }), [open, onOpenChange]);
  return <DialogContext.Provider value={contextValue}>{children}</DialogContext.Provider>;
}

export function DialogTrigger({
  children,
  asChild,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean | undefined }) {
  const { onOpenChange } = React.useContext(DialogContext);
  if (asChild && React.isValidElement<{ onClick?: React.MouseEventHandler }>(children)) {
    const originalOnClick = children.props.onClick;
    return React.cloneElement(children, {
      ...props,
      onClick: (e: React.MouseEvent) => {
        originalOnClick?.(e);
        onOpenChange(true);
      },
    });
  }
  return (
    <button type="button" onClick={() => onOpenChange(true)} {...props}>
      {children}
    </button>
  );
}

export function DialogContent({
  className,
  children,
  showCloseButton = true,
}: {
  className?: string | undefined;
  children: React.ReactNode;
  showCloseButton?: boolean | undefined;
}) {
  const { open, onOpenChange } = React.useContext(DialogContext);
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      className={className}
      showCloseButton={showCloseButton}
    >
      <div className="p-6">{children}</div>
    </Modal>
  );
}

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col space-y-1.5 text-left mb-4', className)} {...props} />;
}

export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2 pt-4 border-t border-border-subtle mt-4',
        className,
      )}
      {...props}
    />
  );
}

export function DialogTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn('text-base font-bold leading-none tracking-tight text-ink', className)}
      {...props}
    />
  );
}

export function DialogDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-xs text-ink-muted leading-relaxed', className)} {...props} />;
}

export function DialogClose({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { onOpenChange } = React.useContext(DialogContext);
  return (
    <button type="button" onClick={() => onOpenChange(false)} {...props}>
      {children}
    </button>
  );
}
