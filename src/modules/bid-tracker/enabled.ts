/** Bid Tracker is dark-launched per environment behind this build flag (same
 *  convention as VITE_ADMIN_IMPORT_ENABLED). A function, not a constant, so a
 *  test can stub the env var and re-render without reloading the module. */
export const isBidTrackerEnabled = () => import.meta.env.VITE_BID_TRACKER_ENABLED === 'true'
