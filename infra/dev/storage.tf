# Phase 4 — attachments bucket.

resource "google_storage_bucket" "attachments" {
  name                        = "${var.project_id}-attachments"
  location                    = "asia-south1"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced" # spec §11 — never public, backend controls access via signed URLs
  # force_destroy left unset/false in dev to match the eventual prod
  # posture and catch accidental early deletes (see plan Task 4.1 rollback note).

  # Bid Tracker uploads are a direct browser PUT to a signed URL, which is a
  # cross-origin request to storage.googleapis.com — without this the browser
  # blocks it at preflight even though the signed URL itself is valid.
  cors {
    origin          = ["https://goms-dev.web.app", "https://goms-dev.firebaseapp.com", "http://localhost:5190"]
    method          = ["PUT", "GET", "HEAD"]
    response_header = ["Content-Type"]
    max_age_seconds = 3600
  }

  # Bid Tracker (spec §14, §21.1): uploads land first under
  # bid-tracker/_pending/{uploadId}/... and are moved to their canonical path
  # by documents.confirmUpload. Anything left in _pending/ — an abandoned or
  # failed upload — is purged after 24h with no app-level cron needed.
  lifecycle_rule {
    condition {
      age            = 1
      matches_prefix = ["bid-tracker/_pending/"]
    }
    action {
      type = "Delete"
    }
  }
}
