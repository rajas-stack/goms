# Mirrors infra/dev/cloudrun.tf's goms-api service and goms-migrate job.
# Two deliberate differences from dev, both called out below:
#
#   1. No `goms_seed_import` job. That job loads the frontend's demo/
#      reference seed data — Stage B plan §5 is explicit that this has no
#      place in production. Production's real initial data load (if any) is
#      a separate, not-yet-scoped question (plan §7) — deliberately not
#      guessed at here.
#   2. No `allUsers` invoker grant declared here (contrast with dev's
#      deliberate launch decision, infra/dev/cloudrun.tf:69-74) — intended
#      to keep goms-prod requiring an authenticated caller by default until
#      a real cutover decision is made. **Known drift, not reconciled by
#      this file (2026-09-04):** live `goms-prod` currently DOES have
#      `allUsers` → `roles/run.invoker`, granted out-of-band via `gcloud`,
#      not through Terraform — confirmed via `gcloud run services
#      get-iam-policy`. Tracked as DRIFT-001 (project-wide "no auth
#      anywhere yet" debt, see docs/superpowers/analysis/2026-08-27-goms-
#      prod-temporary-drift-register.md), deliberately left unmanaged here
#      rather than adding an IAM resource that would revert it on the next
#      apply — closing/keeping this open is a availability/access decision
#      for the user to make explicitly, not something this promotion's
#      Terraform cleanup should decide silently either way.

resource "google_artifact_registry_repository" "goms" {
  repository_id = "goms"
  location      = "asia-south1"
  format        = "DOCKER"
}

resource "google_service_account" "goms_api_runtime" {
  account_id   = "goms-api-runtime"
  display_name = "GOMS API runtime (Cloud Run)"
}

resource "google_project_iam_member" "runtime_cloudsql" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.goms_api_runtime.email}"
}

resource "google_secret_manager_secret_iam_member" "runtime_secret_access" {
  secret_id = google_secret_manager_secret.goms_db_url.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.goms_api_runtime.email}"
}

resource "google_storage_bucket_iam_member" "runtime_bucket_access" {
  bucket = google_storage_bucket.attachments.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.goms_api_runtime.email}"
}

# Image pinned to the commit-SHA tag actually running live on goms-prod
# (confirmed 2026-09-07 via `gcloud run services describe` — revision
# goms-api-00016-kkd, traffic explicitly pinned to it, image digest matches
# this tag exactly). This is the auth-architecture release candidate
# (docs/superpowers/plans/2026-09-04-goms-auth-architecture-implementation-plan.md),
# deployed manually (`gcloud run deploy`, out-of-band from Terraform, same
# established pattern as every prior prod promotion) as an explicit no-op:
# AUTH_ENFORCEMENT_ENABLED/EMERGENCY_READ_ONLY below are both "false", so
# every procedure behaves exactly as it did on the prior image. Turning
# enforcement on is a separate, explicitly-approved follow-up, not part of
# this deploy.
resource "google_cloud_run_v2_service" "goms_api" {
  name     = "goms-api"
  location = "asia-south1"

  # Codifies the service-level scaling block's live default (automatic
  # scaling, not the service-level "manual instance count" feature) so this
  # plan doesn't propose removing it — confirmed via `gcloud run services
  # describe --format=json`'s `run.googleapis.com/scalingMode: automatic`
  # annotation. It was showing as drift purely because this file never
  # declared it, not because anything about it needs to change.
  scaling {
    scaling_mode          = "AUTOMATIC"
    manual_instance_count = 0
  }

  template {
    service_account = google_service_account.goms_api_runtime.email
    # min_instance_count: same accepted cold-start tradeoff as dev.
    # max_instance_count=10 codifies the live value (confirmed via
    # `autoscaling.knative.dev/maxScale: "10"`, set via a manual `gcloud run
    # services update`, not through this file) so this plan doesn't propose
    # reverting it to unbounded, which is what applying with the field left
    # unset would do.
    scaling {
      min_instance_count = 0
      max_instance_count = 10
    }

    vpc_access {
      network_interfaces {
        network    = google_compute_network.goms_vpc.id
        subnetwork = google_compute_subnetwork.goms_subnet.id
      }
      egress = "PRIVATE_RANGES_ONLY" # Direct VPC egress — no load balancer, matches Stage B plan §1/§6
    }

    containers {
      image = "asia-south1-docker.pkg.dev/${var.project_id}/goms/goms-api:6f376438f4ae0ef084fccab447afc8f93ac50c09"
      # This service is only ever reached through Firebase Hosting's
      # `/api/**` rewrite (firebase.json), which arrives from a Google
      # front-end address and carries CDN addresses in X-Forwarded-For. Without
      # this, Fastify's per-IP rate limiter keys every visitor onto the same
      # bucket. `firebase-hosting` makes the limiter read Fastly-Client-IP
      # instead — see apps/api/src/client-ip.ts.
      env {
        name  = "TRUST_PROXY"
        value = "firebase-hosting"
      }
      # AUTH_ENFORCEMENT_ENABLED flipped to "true" 2026-09-07 (revision
      # goms-api-00018-qrk) — explicit user approval, config-only change, same
      # application image as the no-op release above. EMERGENCY_READ_ONLY
      # stays "false" — the incident kill switch, not touched by this change.
      env {
        name  = "AUTH_ENFORCEMENT_ENABLED"
        value = "true"
      }
      env {
        name  = "EMERGENCY_READ_ONLY"
        value = "false"
      }
      # goms-prod's own Firebase project (Hosting-only until 2026-09-07):
      # Authentication + Google Sign-In enabled and a web app registered
      # this session (console step for enabling the Google provider, no API
      # exists for it — same finding as goms-dev-auth's setup). Deliberately
      # this project, not a separate dedicated one like goms-dev-auth — dev
      # needed isolation from prod; prod's own users signing into prod's own
      # project needs no such separation.
      env {
        name  = "FIREBASE_PROJECT_ID"
        value = "goms-prod"
      }
      # ADMIN_IMPORT_ENABLED / ADMIN_IMPORT_ALLOWED_EMAILS: reconciled
      # 2026-09-15 to match confirmed live state (`gcloud run services
      # describe goms-api --project=goms-prod`, prod-vs-dev parity audit —
      # see docs/superpowers/analysis/2026-09-15-goms-prod-admin-import-
      # parity-reconciliation.md). This comment previously said the flag
      # "stays unset" as of 2026-09-04; that stopped being true at some
      # point after that date when it was flipped on, out-of-band via
      # `gcloud`, without this file ever being updated — Terraform never
      # declared either env var, so this file was silently describing a
      # disabled feature while production had it enabled. Nothing about
      # production was changed to write this comment; it only corrects the
      # record to match what `gcloud` already showed as live.
      #
      # This is NOT the "no real auth gate" exposure the old comment warned
      # against. `adminImportProcedure` (apps/api/src/trpc.ts) has required
      # a valid, cryptographically-verified Firebase ID token plus an
      # allow-list check unconditionally since it was written —
      # `verifyAdminImportToken` (apps/api/src/auth/verifyAdminImportToken.ts)
      # calls `verifyFirebaseToken` (apps/api/src/auth/identity.ts), which
      # verifies the token against *this* project (`FIREBASE_PROJECT_ID`
      # above, i.e. `goms-prod`'s own Firebase Auth) and requires
      # `email_verified`, then checks the email against
      # ADMIN_IMPORT_ALLOWED_EMAILS below. This check does not depend on
      # AUTH_ENFORCEMENT_ENABLED — it is always active regardless of that
      # flag's value.
      #
      # The production *frontend* does not expose this feature: there is no
      # `deploy-prod` stage in `.gitlab-ci.yml` (goms-prod Hosting deploys
      # are manual, out-of-band, same as this API), and no build pushed to
      # `goms-prod` has ever set `VITE_ADMIN_IMPORT_ENABLED` — confirmed by
      # fetching the live hosted bundle (`https://goms-prod.web.app`), which
      # contains no `/admin/data-import` route code at all (contrast
      # `goms-dev`'s hosted bundle, which does — CI sets that flag only for
      # the goms-dev build, `.gitlab-ci.yml`). Access to this endpoint is
      # therefore restricted entirely at the API/auth layer above, not by
      # omitting a UI button.
      env {
        name  = "ADMIN_IMPORT_ENABLED"
        value = "true"
      }
      env {
        name = "ADMIN_IMPORT_ALLOWED_EMAILS"
        # Matches infra/dev/cloudrun.tf's list exactly — confirmed live via
        # `gcloud run services describe` (2026-09-15). Not a secret: a
        # roster of who may use this feature, not a credential, same
        # reasoning as infra/dev/cloudrun.tf's identical env var.
        value = "rajas@amnex.com,rajassaji9@gmail.com,shubham16@amnex.com"
      }
      env {
        name = "DATABASE_URL"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.goms_db_url.secret_id
            version = "latest"
          }
        }
      }
      env {
        name  = "ATTACHMENTS_BUCKET"
        value = google_storage_bucket.attachments.name
      }
    }
  }
}

# Deliberately no google_cloud_run_v2_service_iam_member "public_invoke" here
# — see the file header above.

resource "google_cloud_run_v2_job" "goms_migrate" {
  name     = "goms-migrate"
  location = "asia-south1"

  template {
    template {
      service_account = google_service_account.goms_api_runtime.email
      max_retries     = 0

      vpc_access {
        network_interfaces {
          network    = google_compute_network.goms_vpc.id
          subnetwork = google_compute_subnetwork.goms_subnet.id
        }
        egress = "PRIVATE_RANGES_ONLY"
      }

      containers {
        # Kept in lockstep with goms_api's image above (confirmed identical
        # live via `gcloud run jobs describe`) so a migration run always
        # reflects the exact same code as the service it's migrating the
        # schema for.
        image   = "asia-south1-docker.pkg.dev/${var.project_id}/goms/goms-api:6f376438f4ae0ef084fccab447afc8f93ac50c09"
        command = ["node"]
        args    = ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up"]
        env {
          name = "DATABASE_URL"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.goms_db_url.secret_id
              version = "latest"
            }
          }
        }
      }
    }
  }
}
