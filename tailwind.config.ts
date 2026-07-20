import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: '#1A2332',
          900: '#0F2942',
          800: '#14314C',
          700: '#1E3A5F',
          600: '#2B4A70',
        },
        paper: '#FAFAF7',
        panel: '#F1F3F7',
        line: '#DDE3EC',
        indigo: {
          DEFAULT: '#5B6EE8',
          600: '#4453C4',
          100: '#E7EAFC',
        },
        teal: {
          DEFAULT: '#2A7F6F',
          600: '#22695B',
          100: '#DDEEE9',
        },
        crimson: { DEFAULT: '#B23A48', 100: '#F6E0E3' },
        // Semantic hierarchy accents — desaturated to sit alongside ink/indigo/
        // teal. States=blue, offices=purple, employees=emerald, vacant=amber.
        blue: { DEFAULT: '#2F6FBF', 600: '#245A9E', 100: '#DEE9F6' },
        purple: { DEFAULT: '#7A5AC9', 600: '#6247A8', 100: '#EBE4F7' },
        emerald: { DEFAULT: '#2F8F5B', 600: '#26744A', 100: '#DCEFE3' },
        amber: { DEFAULT: '#C77A2A', 600: '#A5641F', 100: '#F7E9D6' },
        muted: '#5C6B80',
      },
      fontFamily: {
        display: ['"Bricolage Grotesque"', 'system-ui', 'sans-serif'],
        sans: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        card: '14px',
      },
      boxShadow: {
        panel: '0 1px 2px rgba(15,41,66,0.04), 0 8px 24px rgba(15,41,66,0.08)',
        pop: '0 12px 40px rgba(15,41,66,0.18)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
      },
      animation: {
        'fade-in': 'fade-in 0.3s ease both',
      },
    },
  },
  plugins: [],
} satisfies Config
