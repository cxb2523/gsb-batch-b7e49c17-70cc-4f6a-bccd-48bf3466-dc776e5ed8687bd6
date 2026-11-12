/** @type {import('tailwindcss').Config} */
// Colours are CSS variables (defaults in app/globals.css), so a project's
// branding/ can replace them at runtime; see routes/branding.py.
const v = (name) => `rgb(var(--cn-${name}) / <alpha-value>)`;

module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        // datavloot's typefaces, as on the website
        sans: ['"IBM Plex Sans"', 'system-ui', '-apple-system', '"Segoe UI"', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'Menlo', 'Consolas', 'monospace'],
      },
      colors: {
        datavloot: {
          50:  v('accent-50'),    // soft fills, selected rows
          100: v('accent-100'),   // bg-soft
          200: v('accent-200'),   // border-soft
          400: v('accent-400'),
          600: v('accent-600'),   // accent — links, buttons, spinner
          700: v('accent-700'),   // accent dark
          800: v('accent-800'),   // navy
          900: v('accent-900'),   // deep navy — the sidebar
        },
        surface: {
          0: '#ffffff',           // bg-elevated — cards
          1: v('surface-1'),      // bg — page background
          2: v('surface-2'),      // bg-soft — hover states
          3: v('surface-3'),      // border — dividers
        },
        ink: {
          0: v('ink-0'),          // text
          1: v('ink-1'),          // text intermediate
          2: v('ink-2'),          // text-muted
          3: v('ink-3'),          // text-dim
        },
        // ochre, for the active tab and focus; not for buttons
        highlight: {
          DEFAULT: v('highlight'),
          700: v('highlight-700'),
        },
        // the sidebar's background
        sidebar: v('sidebar'),
      },
    },
  },
  plugins: [],
};
