# Mirrors infra/dev/storage.tf exactly — attachments bucket, never public.

resource "google_storage_bucket" "attachments" {
  name                        = "${var.project_id}-attachments"
  location                    = "asia-south1"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced" # never public, backend controls access via signed URLs
  # force_destroy left unset/false, same as dev — catches accidental early
  # deletes; doubly important in prod.

  # Bid Tracker uploads are a direct browser PUT to a signed URL, a cross-origin
  # request to storage.googleapis.com — without this the browser blocks it at
  # preflight even though the signed URL is valid. Origins are the production
  # Firebase Hosting hosts; add a custom domain here if/when one is attached.
  cors {
    origin          = ["https://goms-prod.web.app", "https://goms-prod.firebaseapp.com"]
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
