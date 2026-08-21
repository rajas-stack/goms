import '@testing-library/jest-dom/vitest'

// jsdom has no scrollIntoView implementation at all — every sticky
// section-jump nav button (CreateBoq.tsx, ProposalDetail.tsx,
// BoqWorkspaceHeader's Preview button) calls it directly, and clicking one
// in a test throws a hard TypeError without this stub.
if (typeof window !== 'undefined' && !window.HTMLElement.prototype.scrollIntoView) {
  window.HTMLElement.prototype.scrollIntoView = () => {}
}

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
