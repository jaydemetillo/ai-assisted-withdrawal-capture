import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Pulse design tokens (Figma: Pulse Master V2)
        brand: { 50: '#faf0fb', 600: '#9c2fa7', 900: '#5a1b61' },
        primary: { 600: '#0d4fca' }, // color/brand/primary/600 — desktop page titles
        canvas: { DEFAULT: '#ffffff', alt: '#f8f9f9' },
        content: {
          strong: '#2c2e34',
          DEFAULT: '#454953',
          medium: '#666c7a',
          subtle: '#838894',
          tertiary: '#737373',
          table: '#667085',
        },
        divider: { medium: '#ededed', strong: '#bfbfbf' },
        warning: '#ffda68',
        critical: '#ee8080',
      },
      fontFamily: {
        sans: ['"Nata Sans"', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      boxShadow: {
        sm2: '0px 0px 5px rgba(191,191,191,0.5)',
        card: '0px 2px 4px rgba(104,104,104,0.1)',
        raised: '0px 4px 6px rgba(104,104,104,0.2)',
        header: '0px 4px 16px rgba(153,165,192,0.15)',
        shutter: '0px 3px 6px rgba(0,0,0,0.11)',
      },
      borderRadius: { '4xl': '40px' },
    },
  },
  plugins: [],
};
export default config;
