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

Tests perform read-only requests; they do not create or modify mail, events, documents, notes, tasks, or meetings. Docs and Sheets can discover an existing file or use an optional test resource ID. Without a file, the result is "Authorized", not "API verified". Maps and modern Sites verify the account binding and launch the web service; they do not claim an API connection. Keep depends on Workspace administrator access. Cloud Translation needs an enabled/billed Cloud project; NotebookLM API access uses NotebookLM Enterprise and its project location.

Enable the required Google APIs, configure the OAuth client's authorized JavaScript origins, and apply `1791763800000_google-integrations.sql` before deploying the API. Google may require consent/admin approval for requested scopes. Firebase sign-in alone does not grant Google API access.

References: [Google Identity Services](https://developers.google.com/identity/oauth2/web/reference/js-reference), [Google Sites](https://developers.google.com/workspace/sites), [Google Keep](https://developers.google.com/workspace/keep/api/guides), [NotebookLM Enterprise](https://docs.cloud.google.com/gemini/enterprise/notebooklm-enterprise/docs/api-notebooks).
