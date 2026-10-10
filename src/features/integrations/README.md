# Google integrations

`Settings > Integrations` binds Google services to the verified Amnex Google identity signed in to GOMS. User settings sync through `googleIntegrations.get/save` when the API is configured; local mode stores metadata under the Firebase UID. Access tokens remain in memory and are discarded when the account changes. Google OAuth client IDs are public configuration, not client secrets.

## Register a feature

Add a `*.google-integration.ts` sidecar next to a feature. The registry discovers these files eagerly so pages appear even before a lazy route is visited:

```ts
import type { GoogleIntegrationFeature } from '@/features/integrations/registry'

export default [{
  id: 'account-calendar',
  page: { id: 'accounts', label: 'Accounts mapping', path: '/map' },
  services: ['calendar'],
}] satisfies GoogleIntegrationFeature[]
```

Use stable page IDs. Features sharing a page are deduplicated in each service's dropdown. New pages start enabled; explicitly disabled pages stay disabled. No changes to the Integrations page are needed.

Subscribe with `useGoogleAccount()` and check `googleServiceEnabled('calendar', 'accounts')` before rendering a feature. For an API action, preload `loadGoogleIdentity()` and invoke `googleFeatureToken('calendar', 'accounts')` from the user's click. This checks page activation, requests only the needed permissions, and reuses an unexpired grant for the same account and OAuth client. Preserve existing module permissions separately.

## Connection checks

Tests perform read-only requests; they do not create or modify mail, events, documents, notes, tasks, or meetings. Docs and Sheets can discover an existing file or use an optional test resource ID. Without a file, the result is "Authorized", not "API verified". Sites tests Drive access and can list site files; modern Sites has no page-editing API. The Maps test only verifies account binding; the workspace embeds an actual map using a separately restricted Maps Embed API key. Keep depends on Workspace administrator access. Cloud Translation needs an enabled/billed Cloud project; NotebookLM API access uses NotebookLM Enterprise and its project location.

## Use services inside GOMS

The settings page is the deployment controller. Each service has a saved **Active/Inactive** switch, a page-assignment dropdown and **Test & preview**. There are no external service-launch links on this page. Activation is separate from Google authorization: an active service still needs valid API access. Deactivating a service disables it on all assigned pages while preserving those choices for reactivation. Configuration is scoped to the signed-in Firebase UID and syncs through the API in remote mode; it is not an organization-wide Workspace policy.

**Test & preview** makes a Google connection check and opens a read-only in-app API preview. Inactive services can still be diagnosed, but test mode cannot send mail, upload files, create resources or otherwise write Google data. Translation and Maps previews use their appropriate Cloud/Embed interfaces. API errors remain visible rather than being reported as connected.

Enabled modules show **Google tools** inside the running application. Selecting a service opens its actual API widget in a modal over the current module; no external redirect is needed for these operations:

| Service | API operations |
| --- | --- |
| Gmail | Load message headers; compose and send UTF-8 plain-text email |
| Drive | List files; create folders; upload files up to 25 MB |
| Docs | List documents; read document/tab text; create a document with text |
| Sheets | List spreadsheets; read ranges; create spreadsheets; append literal rows |
| Calendar | List upcoming primary-calendar events; create events |
| Chat | List spaces; read messages; send messages as the signed-in user |
| Meet | List conference records; create a meeting and obtain its join link |
| Maps | Show an interactive map with a preset address inside GOMS |
| Translate | Translate text through Cloud Translation |
| Sites | List site files from Drive; editing remains in Google Sites |
| Notes (Keep) | List and create notes where the Workspace account is eligible |
| NotebookLM | List recently viewed Enterprise notebooks; retrieve/create notebooks |
| Tasks | List task lists; read and create tasks in a selected list |

Read and write actions request their required OAuth scopes incrementally. Existing read grants do not imply write consent. Operations call Google's HTTPS APIs, surface Google's errors, and never turn a redirect or a sign-in into a successful operation. Google data, tokens and form content stay in memory; responses are discarded on account changes and private views clear when the tab is hidden. Writes are initiated explicitly by the user and are not automatically retried. These direct Google operations are governed by Google access/Workspace policies; the application's database mutation audit does not observe them.

The shared widget dock registers six module pages (Accounts mapping, Meetings, Sales, Teams, Commercial calculator and Opportunity/Bid tracker) for every service, including module subroutes and their DMS document routes. Future sidecars remain automatically discovered. The settings controller is not itself a deployment target. Reuse `<GoogleWorkspacePanel service="calendar" pageId="accounts" />` on another actual feature page alongside its sidecar; actions enforce both master activation and page assignment. Widgets currently return bounded first pages (10 mail messages, up to 20 other items), not a full synchronization job. They do not provide background sync, mailbox body search, a full native Google editor, or NotebookLM chat.

For Maps, enable Maps Embed API and save a browser key in Connection setup restricted to that API and your exact site referrers. It is reused by deployed map widgets. No Google OAuth grant is sent to the iframe. The key is public browser configuration, not a private credential. For NotebookLM, configure the project number/location and Enterprise license/IAM access. For Keep, approve the eligible enterprise account/API access with your Workspace administrator. Google Sites editing and video calls inside the native Meet UI are not implemented by these widgets; Sites file listing and Meet space creation use the available APIs.

Enable the required Google APIs, configure the OAuth client's authorized JavaScript origins, and apply `1791763800000_google-integrations.sql` before deploying the API. Google may require consent/admin approval for requested scopes. Firebase sign-in alone does not grant Google API access.

References: [Google Identity Services](https://developers.google.com/identity/oauth2/web/reference/js-reference), [Google Sites](https://developers.google.com/workspace/sites), [Google Keep](https://developers.google.com/workspace/keep/api/guides), [NotebookLM Enterprise](https://docs.cloud.google.com/gemini/enterprise/notebooklm-enterprise/docs/api-notebooks).
