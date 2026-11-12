import type { CSSProperties } from 'react';

/** The dropdown arrow for the management page's native selects (they use `appearance-none`). */
export const selectChevronStyle: CSSProperties = {
  backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236f7e91' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`,
  backgroundPosition: 'right 0.6rem center',
  backgroundRepeat: 'no-repeat',
  backgroundSize: '1.2em 1.2em',
};
