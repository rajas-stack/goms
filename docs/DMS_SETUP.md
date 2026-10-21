# DMS Settings

Open the top-right profile (signed in) or gear (signed out), choose **Settings**, then **DMS Settings**. The dedicated page at `/settings/dms` lists saved connections and offers **Create new**. OAuth and folder inputs appear only after creation or when configuring an existing connection. Appearance and keyboard shortcut panels are removed from Settings; the menu retains its theme controls.

## Google Drive connection

1. Choose **Create new** and give the DMS a unique name.
2. In Google Cloud, enable the Drive API and create an OAuth 2.0 **Web application** client. For local development, register `http://localhost` and `http://localhost:5173` as Authorized JavaScript origins. For deployment, register the actual HTTPS site origin. This integration uses a popup token flow, so it needs no redirect URI.
3. Enter the public OAuth client ID in the UI, connect the Google account, and approve Drive access. No hardcoded credential, environment variable, API key, or client secret is required.
4. Enter a My Drive or shared-drive folder URL/ID and choose **Verify folder**, or leave the folder blank and choose **Create root folder**.
5. Save and open **Documents** to browse folders, search file names, filter categories, upload, add versions, rename, and move files to trash. Open a document in Drive to download, share, or view history.

The maximum upload size is optional. Clear the field for no app-imposed limit; any positive whole number is supported. Google Drive's own limits still apply.

## Assign places

The dropdown next to each connection supports multiple selections: Accounts mapping, Meetings, Sales, Teams, Commercial calculator, and Opportunity / Bid tracker. Each place has one designated DMS; selecting it on a different connection moves the assignment. Assigned places show a **Documents** button in the top bar that opens their selected DMS library. This is a module document library; existing GCS-backed bid attachments continue using their existing repository.

Each connection retains separate OAuth settings, folders, and in-memory authorization. Saved accounts are labelled Reconnect when their active browser session has ended.

## Master DMS

Choose **Add master DMS** to configure one Google Drive destination. Share each source DMS folder with the master Google account. **Collect documents** copies documents into `master root / DMS name / original subfolders`. It preserves nesting, skips current copies, refreshes changed copies, and reports inaccessible sources while continuing with the others. Source files are retained. Google Drive shortcuts are skipped to avoid cycles.

Uploads also copy into the master while its session is connected. If that copy cannot complete, the original upload succeeds and the UI reports that master collection is pending. Reconnect the master and collect documents to catch up. External portal connections have no file API and are not included in collection.

## External DMS

Select **External DMS (portal link)**, enter an HTTPS URL, and save. The connection opens the existing document portal; files and sign-in are managed by that provider.

Configuration is saved on this browser/device. Access tokens stay in memory and require reconnection after expiry or reload. Removing a connection removes its GOMS settings and assignments; Drive documents are retained. Collection and refresh run while the app is open, without a background server job.

## Profile Images

**Settings → System settings → DMS → Profile Images** configures a shared, server-managed image folder. A System Admin with DMS edit access connects Google Drive, chooses **Browse folders** or **Paste folder link**, then chooses **Test Connection**, **Save**, or **Sync Now**. The selected folder is displayed by name, with no raw ID or ID input in the normal view. **Browse folders** starts at My Drive and shows only the current folder's direct subfolders. Open a folder to navigate deeper, use the breadcrumbs or back button to return, and choose **Use folder** or **Use this folder** to select it. The section reports connection status, last successful sync, photos found, matched people, and files to review. Sync feedback includes actual counts and calls out zero matches. **Remove folder**, then **Save**, disables this feature.

Profile Images reuses the backend Google OAuth client, registered `/api/oauth/google/callback`, credential encryption, and expiring OAuth flow store already used by Email Center. Existing `EMAIL_GOOGLE_*` settings (or their `GOOGLE_OAUTH_*` fallbacks) and the existing encryption secret must be configured. This separate authorization requests offline `drive.readonly` access; browser-only DMS tokens cannot provide durable server access. The folder stays private and must be accessible to the connected administrator's Google account.

The selected folder, encrypted credentials, file metadata, change cursor, and mappings are stored in the existing `google_integration_settings` JSONB store under a system key. No migration or additional image store is used. Image bytes remain in Drive, with only a bounded, transient server memory cache and private browser caching.

JPG/JPEG, PNG, and WebP files directly inside the selected folder are indexed once, then updated with Drive's paginated changes feed every minute while the API process runs. The first scan captures its change cursor before listing files. Shared-drive folders use their drive-specific change feed. Files moved out, deleted, trashed, or replaced update the index. Failed partial scans retain the last complete cursor for retry; permission loss clears mappings. There is no push notification or claim of instant Drive change detection.

Filenames match record IDs, exact emails, or existing employee codes first, then normalized full names (case, separators and common honorifics are ignored). For example, employee **Shubham Mehra**, email **shubham16@amnex.com**, can use **shubham16@amnex.com.png** or **Shubham Mehra.png**. Do not shorten names or guess spelling; email is safest. Keep one photo per person. Duplicate names, conflicting files and unmatched filenames appear as matching errors; unmatched people retain initials.

The index covers `org_people` (Employees), `sales_persons` (Sales), `delivery_team_members` and external People contacts in `employees`. Linked org/team records and unambiguous cross-roster identities share photos, while different emails or duplicate people remain distinct. A single application-level version index supplies avatars in Employees, Sales lists/charts/details, team rosters and People; rendering never searches Drive per person. Photo sync does not remove or filter employee records. Existing photos remain unchanged when this feature is disabled.

Save and Sync Now invalidate the shared index and notify other open tabs after completion. Other Drive changes appear after the next server sync and the application's 15-second metadata refresh. Visible avatars request authenticated backend thumbnails, preferably 96 pixels, with versioned URLs and ETags. Index filtering and image delivery enforce the source module: People contacts need contact policy/directory visibility, Employees and team mirrors need company-org access/Teams visibility, and Sales photos need Sales policy/page visibility. Checks precede conditional 304 responses. Configuration requires the administrator allow-list and DMS permissions. Google tokens and private thumbnail URLs never reach the frontend.

## References

- [Google OAuth client setup](https://developers.google.com/identity/oauth2/web/guides/get-google-api-clientid)
- [Google Identity Services token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model)
- [Drive uploads](https://developers.google.com/workspace/drive/api/guides/manage-uploads)
- [Drive authorization scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- [Drive incremental changes](https://developers.google.com/workspace/drive/api/reference/rest/v3/changes/list)
- [Private thumbnail links](https://developers.google.com/workspace/drive/api/reference/rest/v3/files)

The integration requests the Drive scope to work with arbitrary existing folders. Configure the Google project's consent screen and verification for the intended audience before deploying.
