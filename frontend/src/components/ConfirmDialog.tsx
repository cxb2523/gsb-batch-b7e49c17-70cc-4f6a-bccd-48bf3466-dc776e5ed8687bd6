import * as React from 'react';
import { Modal } from './Modal';
import { Button } from '@/components/ui/button';

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  titleId?: string | undefined;
  description?: React.ReactNode | undefined;
  confirmLabel?: string | undefined;
  cancelLabel?: string | undefined;
  variant?: 'destructive' | 'default' | undefined;
  isPending?: boolean | undefined;
  onConfirm: () => void | Promise<void>;
  confirmDisabled?: boolean | undefined;
  confirmButtonId?: string | undefined;
  children?: React.ReactNode | undefined;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  titleId,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  isPending = false,
  onConfirm,
  confirmDisabled = false,
  confirmButtonId,
  children,
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      titleId={titleId}
      description={description}
      showCloseButton={!isPending}
    >
      <div className="px-6 pb-6 pt-2">
        {children && <div className="mb-5">{children}</div>}

        <div className="flex items-center justify-end gap-2.5 pt-4 border-t border-border-subtle">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
            className="text-xs font-semibold"
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            id={confirmButtonId}
            variant={variant === 'destructive' ? 'destructive' : 'default'}
            size="sm"
            onClick={() => void onConfirm()}
            disabled={isPending || confirmDisabled}
            className="text-xs font-semibold"
          >
            {isPending ? 'Processing...' : confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
