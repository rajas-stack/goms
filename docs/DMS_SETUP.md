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

## References

- [Google OAuth client setup](https://developers.google.com/identity/oauth2/web/guides/get-google-api-clientid)
- [Google Identity Services token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model)
- [Drive uploads](https://developers.google.com/workspace/drive/api/guides/manage-uploads)
- [Drive authorization scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)

The integration requests the Drive scope to work with arbitrary existing folders. Configure the Google project's consent screen and verification for the intended audience before deploying.
