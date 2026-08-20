import '@testing-library/jest-dom/vitest'

// jsdom has no matchMedia implementation at all (unlike scrollTo, which it
// stubs with a console warning) — anything using useMediaQuery (Dialog,
// ConfirmDeleteDialog) throws a hard TypeError on mount without this.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList
}
