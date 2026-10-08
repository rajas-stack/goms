# Tender websites

Open your profile (or the gear when signed out), then **Settings > Tender websites**. Saved websites appear in the list. The top-right **+ Create new** button opens the creation form.

Each portal has **Name**, **Link**, **User ID**, **Password**, and **DSC**. The DSC dropdown offers active company employees at L0, L1, and L2. Its selection is saved with the portal. This records the certificate holder; it does not upload or use a signing certificate.

When saving credentials for the first time, enter and confirm a passphrase of at least eight characters in the form. **Create** or **Save** applies it. User ID and Password are encrypted together using AES-256-GCM and a key derived with PBKDF2-SHA-256 (600,000 iterations, a fresh salt and IV). Only the encrypted envelope is stored locally or sent to the API. The passphrase itself is never stored.

Each saved portal has a small edit-lock slider. Locking disables the Edit action and blocks API updates; unlocking restores editing. The slider state is saved with the website. **View credentials** is available in either state, and every newly opened viewer requires the portal's passphrase. The password stays masked until Show Password is clicked after unlocking.

Edit a portal and click either credential lock to unlock both fields with its passphrase. **Change passphrase** requires the current passphrase, then shows **New passphrase** and **Confirm passphrase**. **Save** encrypts the credentials again using the new passphrase; the old passphrase can no longer open the updated record. Closing the editor or saving locks the fields again. Name, Link, and DSC can be changed while credentials remain locked. **Lock credentials** discards unsaved credential edits. Keep the passphrase available to the people who need this portal; it cannot be recovered from the saved record.

Connected deployments must apply all pending API migrations, including `1790700000000_org-people`, `1791590400000_tender-website-credentials`, and `1791676800000_tender-website-edit-lock`, before running the updated API. DSC references use the existing company directory's UUIDs. Existing portal records continue to work with blank credentials and DSC and editing unlocked.

Pre-bid meetings in a bid's General tab now have separate date/time, address, and notes fields. Old combined rows are read into the new fields without discarding their text. The address button uses [Google Maps URLs](https://developers.google.com/maps/documentation/urls/get-started) to open a search pin for the entered address in the supported app or browser.
