# Tender websites

Open your profile (or the gear when signed out), then **Settings → Tender websites**.

Each portal has **Name**, **Link**, **User ID**, **Password**, and **DSC**. The DSC dropdown offers active company employees at L0, L1, and L2. Its selection is saved with the portal. This records the certificate holder; it does not upload or use a signing certificate.

When saving credentials for the first time, choose and confirm a credential passphrase of at least eight characters. User ID and Password are encrypted together using AES-256-GCM and a key derived with PBKDF2-SHA-256 (600,000 iterations, a fresh salt and IV). Only the encrypted envelope is sent to the API or included in local backups. The passphrase is never saved.

Edit a saved portal and click either credential lock to unlock both fields with that portal's passphrase. Closing the editor or saving locks them again. Name, Link, and DSC can be changed while credentials remain locked. **Lock credentials** discards unsaved credential edits. Keep the passphrase available to the people who need this portal; it cannot be recovered from the saved record.

Connected deployments must apply the new `1791580000000_company-org-directory` and `1791590400000_tender-website-credentials` migrations before running the updated API. The company directory starts with the same employees and levels as the existing local org structure and can be maintained through its employee page. Existing portal records continue to work with blank credentials and DSC.

Pre-bid meetings in a bid's General tab now have separate date/time, address, and notes fields. Old combined rows are read into the new fields without discarding their text. The address button uses [Google Maps URLs](https://developers.google.com/maps/documentation/urls/get-started) to open a search pin for the entered address in the supported app or browser.
