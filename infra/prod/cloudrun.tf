# Mirrors infra/dev/cloudrun.tf's goms-api service and goms-migrate job.
# Two deliberate differences from dev, both called out below:
#
#   1. No `goms_seed_import` job. That job loads the frontend's demo/
#      reference seed data — Stage B plan §5 is explicit that this has no
#      place in production. Production's real initial data load (if any) is
#      a separate, not-yet-scoped question (plan §7) — deliberately not
#      guessed at here.
#   2. No `allUsers` invoker grant (contrast with dev's deliberate launch
#      decision, infra/dev/cloudrun.tf:69-74). Dev's `allUsers` grant made
#      sense for an already-shipped, actively-used dev environment where
#      removing it prematurely would break real usage with no compensating
#      protection (Stage B plan §1.4 point 6). goms-prod has no such
#      history — nothing depends on public access before cutover, and the
#      Stage B plan's own §19.2 cutover procedure only calls for validating
#      it under a temporary hostname with real stakeholders, not the open
#      internet. Leaving the invoker binding out means Cloud Run defaults to
#      requiring an authenticated caller with `roles/run.invoker` — safer by
#      default for a not-yet-live environment. Whoever needs to reach
#      goms-prod pre-cutover (for validation) should get an explicit,
#      named `google_cloud_run_v2_service_iam_member` binding added when
#      that need is concrete, not a blanket `allUsers` grant applied
#      speculatively. This is a deviation from pure dev/prod duplication —
#      flagged here and in the Stage B checkpoint for the user to override
#      if a broader default is actually wanted.

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

# The image tag below must exist in Artifact Registry before this resource
# can apply — same one-time manual push caveat as dev, except prod's first
# real image should be the exact commit-SHA tag already validated in
# goms-dev (architecture doc §18: "no rebuild between dev and prod"), not a
# fresh :bootstrap build. Placeholder kept for structural parity with dev
# until a real promotion happens.
resource "google_cloud_run_v2_service" "goms_api" {
  name     = "goms-api"
  location = "asia-south1"

  template {
    service_account = google_service_account.goms_api_runtime.email
    scaling { min_instance_count = 0 } # same accepted cold-start tradeoff as dev

    vpc_access {
      network_interfaces {
        network    = google_compute_network.goms_vpc.id
        subnetwork = google_compute_subnetwork.goms_subnet.id
      }
      egress = "PRIVATE_RANGES_ONLY" # Direct VPC egress — no load balancer, matches Stage B plan §1/§6
    }

    containers {
      # `:bootstrap` currently resolves to the same image that was pinned by
      # digest (sha256:eced021...) to deploy the dist/import/data/*.json
      # packaging fix (tsc alone never copied the bundled geography JSON
      # files into dist/, so previewGeographyLoad 500'd) — both the digest
      # push and this tag push happened together, so this is a no-op
      # image-wise. Kept as a floating tag for structural parity with dev
      # until a real dev-to-prod promotion pipeline exists (see the header
      # comment at the top of this file).
      image = "asia-south1-docker.pkg.dev/${var.project_id}/goms/goms-api:bootstrap"
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
      # ADMIN_IMPORT_ENABLED was set to "true" temporarily on 2026-08-27 to
      # run the one-time reference-data load (scripts/prod-reference-
      # import.ts), then removed again immediately after — see the temporary
      # drift register's Admin Data Import entry for the full record. Stays
      # unset here permanently until real auth exists per
      # docs/superpowers/plans/2026-08-27-goms-prod-admin-import-enablement-plan.md.
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
        image   = "asia-south1-docker.pkg.dev/${var.project_id}/goms/goms-api:bootstrap"
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
