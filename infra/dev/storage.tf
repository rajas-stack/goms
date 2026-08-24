# Phase 4 — attachments bucket.

resource "google_storage_bucket" "attachments" {
  name                        = "${var.project_id}-attachments"
  location                    = "asia-south1"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced" # spec §11 — never public, backend controls access via signed URLs
  # force_destroy left unset/false in dev to match the eventual prod
  # posture and catch accidental early deletes (see plan Task 4.1 rollback note).
}
