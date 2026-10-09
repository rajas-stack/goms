/** Thrown inside the Android shell when the installed APK predates the native pieces sign-in needs (secure storage, system browser,
 *  deep links). The shell never falls back to localStorage; the user must update the app. */
export class ShellUpdateRequiredError extends Error {
  constructor() { super('shell_update_required'); this.name = 'ShellUpdateRequiredError' }
}
