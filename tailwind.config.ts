import type { Config } from 'tailwindcss';

/**
 * A calm, high-contrast palette. This is a screen used in a corridor after a
 * resuscitation, one-handed, on a phone that may be at 20% brightness — so: large type,
 * few colours, and status carried by a word as well as a colour.
 */
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: { DEFAULT: '#ffffff', sunken: '#f4f6f8' },
        ink: { DEFAULT: '#1c2430', muted: '#5a6676', subtle: '#8a95a3' },
        line: { DEFAULT: '#e3e8ee', strong: '#c7d0da' },
        brand: { 50: '#e9f4f4', 100: '#cbe6e6', 600: '#0f6f6c', 700: '#0a5250', 900: '#063130' },
        ok: { 50: '#e8f6ed', 600: '#1a7f45', 900: '#0d4325' },
        warn: { 50: '#fdf3e2', 600: '#9a6400', 900: '#5c3c00' },
        stop: { 50: '#fdeceb', 600: '#b3261e', 900: '#6b1712' },
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      borderRadius: { xl: '14px', '2xl': '18px' },
      boxShadow: {
        card: '0 1px 2px rgba(28,36,48,0.06), 0 1px 3px rgba(28,36,48,0.04)',
        raised: '0 4px 12px rgba(28,36,48,0.10)',
      },
      minHeight: { tap: '48px' },
    },
  },
  plugins: [],
};
export default config;
