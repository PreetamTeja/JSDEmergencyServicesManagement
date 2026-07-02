/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Sharp light "console" palette (Fleetbase-style)
        cmd: {
          bg: '#ffffff',
          panel: '#ffffff',
          panel2: '#ffffff',
          border: '#d8dce2',
          muted: '#000000',
          text: '#000000',
        },
        // Primary brand green (sourced from design tokens)
        accent: {
          DEFAULT: 'var(--color-primary)',
          glow: 'var(--color-primary-hover)',
        },
        // CTA yellow-green
        cta: {
          DEFAULT: 'var(--color-accent)',
          text: 'var(--color-accent-text)',
        },
        // Brand chart palette + surfaces — "Sage & Linen"
        brand: {
          green: '#2E3A2F',
          green2: '#3E4C3F',
          teal: '#8FAF8A',
          lime: '#8FAF8A',
          pale: '#EDE8DF',
          light: '#EDE8DF', // light surface for active/hover
        },
        status: {
          idle: '#64748b',
          enroute: '#16a34a',
          maint: '#d97706',
          danger: '#dc2626',
        },
      },
      fontFamily: {
        sans: ['Poppins', 'system-ui', 'sans-serif'],
        mono: ['Poppins', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        lg: '8px',   // buttons, inputs
        xl: '12px',  // cards
        '2xl': '16px', // modals
      },
      boxShadow: {
        glow: 'inset 0 0 0 1px rgba(46,58,47,0.25)',
        card: '0 1px 2px rgba(16,24,40,0.06), 0 1px 1px rgba(16,24,40,0.04)',
      },
    },
  },
  plugins: [],
}
