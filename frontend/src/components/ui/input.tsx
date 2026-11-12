import * as React from 'react';
import { cn } from '@/lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          'flex h-11 w-full rounded-lg border border-border-strong bg-surface-warm hover:bg-white focus:bg-white px-3.5 text-sm text-ink placeholder:text-ink-subtle hover:border-ink-subtle focus:border-brand outline-none shadow-2xs focus:shadow-[0_0_0_3px_rgba(220,233,220,0.6)] transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = 'Input';

export { Input };
