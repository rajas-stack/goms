// The free-form date parser now lives in src/lib/friendlyDate.ts so every date
// field in the app shares it (components/ui/FriendlyDateInput). Re-exported
// here so existing bid-tracker imports keep working.
export { formatCapturedDate, parseFriendlyDate } from '@/lib/friendlyDate'
