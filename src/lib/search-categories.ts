export type { SearchCategoryColor, SearchCategoryDef } from '@goms/domain'
export { SEARCH_CATEGORIES, SEARCH_CATEGORY_MAP } from '@goms/domain'

// The frontend's own `SearchContext` (repository.ts's `buildSearchContext`)
// used to be the shape `SearchCategoryDef.match`/`related` took directly.
// That role is now filled by `@goms/domain`'s internal `BuiltContext` — no
// frontend code constructs a `SearchContext` value anymore since `search()`/
// `relatedRecords()` are themselves ported to `@goms/domain`'s
// `performSearch`/`performRelatedRecords` (see `src/data/in-memory/repository.ts`).
