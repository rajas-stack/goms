/** What the user has picked on the timeline: a stage, one issue, or a group of issues. */
export type FocusTarget = { kind: 'phase' | 'event' | 'cluster'; id: string }
