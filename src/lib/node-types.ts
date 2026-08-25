// The node-type registry now lives in packages/domain (shared with apps/api's
// hierarchy router, which needs it for import/move validation) — re-exported
// here so every existing import path (`@/lib/node-types`) keeps working
// unchanged.
export { NODE_TYPE_MAP, POSTING_TYPES, childTypesOf } from '@goms/domain'
