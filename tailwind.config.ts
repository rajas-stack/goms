import type { Config } from 'tailwindcss'

/** A theme-aware color: RGB channels from a `--c-<name>` variable (defined
 *  for light and `.dark` in src/index.css), so Tailwind's opacity modifiers
 *  (`bg-ink-900/40`) keep working. */
const c = (name: string) => `rgb(var(--c-${name}) / <alpha-value>)`

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      // Every color resolves through a CSS variable, so the whole app — every
      // existing `bg-*`/`text-*`/`border-*` class — flips with the theme
      // without per-component `dark:` rules. Default-palette shades the app
      // uses directly (rose-700, amber-50, …) are re-declared so they get a
      // dark counterpart too.
      colors: {
        ink: { DEFAULT: c('ink'), 900: c('ink-900'), 800: c('ink-800'), 700: c('ink-700'), 600: c('ink-600') },
        paper: c('paper'),
        panel: c('panel'),
        line: c('line'),
        // `bg-white` is the raised-surface color (cards, inputs): pure white
        // in light mode, a lifted navy in dark mode.
        white: c('white'),
        // Modal/drawer backdrops.
        scrim: c('scrim'),
        // Spreadsheet surfaces (Opportunity grid, employee tables).
        grid: {
          head: c('grid-head'),
          hover: c('grid-hover'),
          selected: c('grid-selected'),
          frozen: c('grid-frozen'),
          readonly: c('grid-readonly'),
          sorted: c('grid-sorted'),
          tab: c('grid-tab'),
        },
        // Org-chart connector lines.
        edge: c('edge'),
        indigo: { DEFAULT: c('indigo'), 600: c('indigo-600'), 100: c('indigo-100') },
        teal: { DEFAULT: c('teal'), 700: c('teal-700'), 600: c('teal-600'), 100: c('teal-100') },
        crimson: { DEFAULT: c('crimson'), 100: c('crimson-100') },
        // Semantic hierarchy accents — desaturated to sit alongside ink/indigo/
        // teal. States=blue, offices=purple, employees=emerald, vacant=amber.
        blue: { DEFAULT: c('blue'), 700: c('blue-700'), 600: c('blue-600'), 200: c('blue-200'), 100: c('blue-100'), 50: c('blue-50') },
        purple: { DEFAULT: c('purple'), 600: c('purple-600'), 100: c('purple-100') },
        emerald: {
          DEFAULT: c('emerald'), 800: c('emerald-800'), 700: c('emerald-700'), 600: c('emerald-600'),
          200: c('emerald-200'), 100: c('emerald-100'), 50: c('emerald-50'),
        },
        amber: {
          DEFAULT: c('amber'), 900: c('amber-900'), 800: c('amber-800'), 700: c('amber-700'), 600: c('amber-600'),
          500: c('amber-500'), 400: c('amber-400'), 200: c('amber-200'), 100: c('amber-100'), 50: c('amber-50'),
        },
        rose: { 700: c('rose-700'), 50: c('rose-50') },
        red: { 700: c('red-700'), 600: c('red-600'), 200: c('red-200'), 50: c('red-50') },
        sky: { 800: c('sky-800'), 700: c('sky-700'), 50: c('sky-50') },
        muted: c('muted'),
        // GOMS brand palette. Namespaced because Tailwind's own `sky`/`green`
        // scales are already used by other modules. Sky and green are accents
        // (fills, borders, tints); navy carries text and active states.
        goms: { navy: c('goms-navy'), sky: c('goms-sky'), green: c('goms-green') },
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
        panel: '0 1px 2px rgb(var(--c-shadow) / 0.04), 0 8px 24px rgb(var(--c-shadow) / 0.08)',
        pop: '0 12px 40px rgb(var(--c-shadow) / 0.18)',
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
