/** @type {import('tailwindcss').Config} */
function withOpacity(variable) {
  return ({ opacityValue }) => {
    if (opacityValue !== undefined) {
      return `color-mix(in srgb, var(${variable}) calc(100% * ${opacityValue}), transparent)`;
    }
    return `var(${variable})`;
  };
}

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          '"Geist Variable"',
          'Geist',
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'sans-serif',
        ],
        serif: ['Georgia', 'Times New Roman', 'serif'],
        mono: [
          '"Geist Mono Variable"',
          'Geist Mono',
          'SFMono-Regular',
          'JetBrains Mono',
          'Consolas',
          'monospace',
        ],
      },
      colors: {
        paper: withOpacity('--paper'),
        ink: {
          DEFAULT: withOpacity('--ink'),
          hover: withOpacity('--ink-hover'),
          muted: withOpacity('--ink-muted'),
          subtle: withOpacity('--ink-subtle'),
          prose: withOpacity('--ink-prose'),
          secondary: withOpacity('--ink-secondary'),
          tertiary: withOpacity('--ink-tertiary'),
          'pill-bg': withOpacity('--ink-pill-bg'),
          'pill-border': withOpacity('--ink-pill-border'),
          'footer-text': withOpacity('--ink-footer-text'),
        },
        surface: {
          DEFAULT: withOpacity('--surface'),
          2: withOpacity('--surface-2'),
          3: withOpacity('--surface-3'),
          warm: withOpacity('--surface-warm'),
          pill: withOpacity('--surface-pill'),
          'card-hover': withOpacity('--surface-card-hover'),
          '2-hover': withOpacity('--surface-2-hover'),
        },
        border: {
          DEFAULT: withOpacity('--border'),
          strong: withOpacity('--border-strong'),
          subtle: withOpacity('--border-subtle'),
        },
        brand: {
          DEFAULT: withOpacity('--brand'),
          hover: withOpacity('--brand-hover'),
          strong: withOpacity('--brand-strong'),
          subtle: withOpacity('--brand-subtle'),
          'subtle-hover': withOpacity('--brand-subtle-hover'),
          border: withOpacity('--brand-border'),
          tile: withOpacity('--brand-tile'),
          title: withOpacity('--brand-title'),
          metric: withOpacity('--brand-metric'),
          'metric-text': withOpacity('--brand-metric-text'),
        },
        success: {
          DEFAULT: withOpacity('--success'),
          subtle: withOpacity('--success-subtle'),
          bright: withOpacity('--success-bright'),
          light: withOpacity('--success-light'),
        },
        warning: {
          DEFAULT: withOpacity('--warning'),
          subtle: withOpacity('--warning-subtle'),
          border: withOpacity('--warning-border'),
          amber: withOpacity('--warning-amber'),
          dot: withOpacity('--warning-dot'),
          'callout-border': withOpacity('--warning-callout-border'),
          'callout-text': withOpacity('--warning-callout-text'),
          'callout-title': withOpacity('--warning-callout-title'),
        },
        danger: {
          DEFAULT: withOpacity('--danger'),
          hover: withOpacity('--danger-hover'),
          subtle: withOpacity('--danger-subtle'),
          border: withOpacity('--danger-border'),
          light: withOpacity('--danger-light'),
          soft: withOpacity('--danger-soft'),
          'soft-border': withOpacity('--danger-soft-border'),
          muted: withOpacity('--danger-muted'),
        },
        code: {
          bg: withOpacity('--code-bg'),
          border: withOpacity('--code-border'),
        },
        github: withOpacity('--github'),
        avatar: {
          'blue-bg': withOpacity('--avatar-blue-bg'),
          'blue-text': withOpacity('--avatar-blue-text'),
        },

        // Flat aliases for convenience
        'surface-warm': withOpacity('--surface-warm'),
        'surface-pill': withOpacity('--surface-pill'),
        'surface-card-hover': withOpacity('--surface-card-hover'),
        'surface-2-hover': withOpacity('--surface-2-hover'),
        'brand-tile': withOpacity('--brand-tile'),
        'brand-title': withOpacity('--brand-title'),
        'brand-metric': withOpacity('--brand-metric'),
        'brand-metric-text': withOpacity('--brand-metric-text'),
        'brand-hover': withOpacity('--brand-hover'),
        'brand-subtle-hover': withOpacity('--brand-subtle-hover'),
        'avatar-blue-bg': withOpacity('--avatar-blue-bg'),
        'avatar-blue-text': withOpacity('--avatar-blue-text'),
        'warning-amber': withOpacity('--warning-amber'),
        'warning-dot': withOpacity('--warning-dot'),
        'warning-callout-border': withOpacity('--warning-callout-border'),
        'warning-callout-text': withOpacity('--warning-callout-text'),
        'warning-callout-title': withOpacity('--warning-callout-title'),
        'danger-border': withOpacity('--danger-border'),
        'danger-hover': withOpacity('--danger-hover'),
        'danger-light': withOpacity('--danger-light'),
        'danger-soft': withOpacity('--danger-soft'),
        'danger-soft-border': withOpacity('--danger-soft-border'),
        'danger-muted': withOpacity('--danger-muted'),
        'success-bright': withOpacity('--success-bright'),
        'success-light': withOpacity('--success-light'),
        'ink-pill-bg': withOpacity('--ink-pill-bg'),
        'ink-pill-border': withOpacity('--ink-pill-border'),
        'ink-footer-text': withOpacity('--ink-footer-text'),
        'ink-secondary': withOpacity('--ink-secondary'),
        'ink-tertiary': withOpacity('--ink-tertiary'),
        'ink-prose': withOpacity('--ink-prose'),
        'code-bg': withOpacity('--code-bg'),
        'code-border': withOpacity('--code-border'),
        'badge-neutral-border': withOpacity('--badge-neutral-border'),
        'metric-card-border': withOpacity('--metric-card-border'),
        'metric-card-neutral-border': withOpacity('--metric-card-neutral-border'),

        // Standard shadcn semantic tokens
        background: withOpacity('--background'),
        foreground: withOpacity('--foreground'),
        card: {
          DEFAULT: withOpacity('--card'),
          foreground: withOpacity('--card-foreground'),
        },
        popover: {
          DEFAULT: withOpacity('--popover'),
          foreground: withOpacity('--popover-foreground'),
        },
        primary: {
          DEFAULT: withOpacity('--primary'),
          foreground: withOpacity('--primary-foreground'),
        },
        secondary: {
          DEFAULT: withOpacity('--secondary'),
          foreground: withOpacity('--secondary-foreground'),
        },
        muted: {
          DEFAULT: withOpacity('--muted'),
          foreground: withOpacity('--muted-foreground'),
        },
        accent: {
          DEFAULT: withOpacity('--accent'),
          foreground: withOpacity('--accent-foreground'),
        },
        destructive: {
          DEFAULT: withOpacity('--destructive'),
          foreground: withOpacity('--destructive-foreground'),
        },
        input: withOpacity('--input'),
        ring: withOpacity('--ring'),
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
    },
  },
  plugins: [],
};
