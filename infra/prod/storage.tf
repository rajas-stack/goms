# Mirrors infra/dev/storage.tf exactly — attachments bucket, never public.

resource "google_storage_bucket" "attachments" {
  name                        = "${var.project_id}-attachments"
  location                    = "asia-south1"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced" # never public, backend controls access via signed URLs
  # force_destroy left unset/false, same as dev — catches accidental early
  # deletes; doubly important in prod.
}
