/** Shared motion for overlays (dialogs, sheets, drawers, palette): a critically damped spring — it settles
 *  without overshoot, and stays interruptible. Reduced motion is honoured app-wide by <MotionConfig
 *  reducedMotion="user"> in main.tsx. */
export const SPRING_OVERLAY = { type: 'spring', duration: 0.35, bounce: 0 } as const
