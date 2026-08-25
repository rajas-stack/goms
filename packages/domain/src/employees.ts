export type MergeableField =
  | 'name' | 'designation' | 'email' | 'phone' | 'company' | 'address' | 'website'
  | 'relationshipStatus' | 'relationshipQuality' | 'relationshipType' | 'introducedBy' | 'notes'

export const MERGEABLE_FIELDS: MergeableField[] = [
  'name', 'designation', 'email', 'phone', 'company', 'address', 'website',
  'relationshipStatus', 'relationshipQuality', 'relationshipType', 'introducedBy', 'notes',
]
