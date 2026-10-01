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
        // GOMS brand palette. Namespaced because Tailwind's own `sky`/`green`
        // scales are already used by other modules. Sky and green are accents
        // (fills, borders, tints); navy carries text and active states.
        goms: { navy: '#0B2B49', sky: '#4CA7DD', green: '#74C05C' },
      },
      // `display` used to be a separate face ("Bricolage Grotesque") for
      // headings; the whole site is IBM Plex Sans now, so it mirrors `sans`
      // — kept as its own key (rather than removed) since ~20 components
      // reference `font-display` for headings/weights, not just body text.
      fontFamily: {
        display: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
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
      // Black custom cursors for the handful of shapes this app actually
      // uses (grepped every `cursor-*` class site — pointer/grab/grabbing/
      // not-allowed/col-resize/default cover all of them). Every value keeps
      // its native keyword as the final fallback, so a failed asset load, an
      // older browser, or a forced-colors/high-contrast session all still
      // get the correct native shape rather than an invisible cursor. Text
      // selection and every other native shape are deliberately left
      // untouched — not used anywhere in this codebase today, and an I-beam
      // is too thin to meaningfully recolor at cursor scale.
      cursor: {
        default: 'url(/cursors/default.svg) 4 4, default',
        pointer: 'url(/cursors/pointer.svg) 8 3, pointer',
        grab: 'url(/cursors/grab.svg) 12 12, grab',
        grabbing: 'url(/cursors/grabbing.svg) 12 12, grabbing',
        'not-allowed': 'url(/cursors/not-allowed.svg) 12 12, not-allowed',
        'col-resize': 'url(/cursors/col-resize.svg) 12 12, col-resize',
      },
    },
  },
  plugins: [],
} satisfies Config
