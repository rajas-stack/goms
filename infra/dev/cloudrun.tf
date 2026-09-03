# Phase 6 — Artifact Registry repo (6.1), runtime service account (6.2),
# Cloud Run service with Direct VPC egress (6.4). apps/api's code (6.3) is
# already in the repo — see apps/api/.

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
# can apply — plan Task 6.4 Step 1 is a one-time manual `docker push` (needs
# live gcloud/docker credentials); after Phase 10 lands, CI overwrites this
# with real commit-SHA tags on every deploy.
resource "google_cloud_run_v2_service" "goms_api" {
  name     = "goms-api"
  location = "asia-south1"

  # Codifies the service-level scaling block's live default (automatic
  # scaling, not the service-level "manual instance count" feature) so an
  # unrelated apply (Admin Data Import auth env vars, 2026-09-01) doesn't
  # touch it — it was showing as drift purely because this file never
  # declared it, mirroring the identical fix already made in
  # infra/prod/cloudrun.tf.
  scaling {
    scaling_mode          = "AUTOMATIC"
    manual_instance_count = 0
  }

  template {
    service_account = google_service_account.goms_api_runtime.email
    # min_instance_count kept at the original spec §20 cold-start tradeoff;
    # max_instance_count pinned to 10 to match the value CI's `gcloud run
    # deploy` (out-of-band from Terraform) already set on the live service —
    # left at the config's implicit default (unbounded), Task 27's plan/apply
    # would have silently dropped this ceiling as an unintended side effect
    # of the unrelated env-var change below.
    scaling {
      min_instance_count = 0
      max_instance_count = 10
    }

    vpc_access {
      network_interfaces {
        network    = google_compute_network.goms_vpc.id
        subnetwork = google_compute_subnetwork.goms_subnet.id
      }
      egress = "PRIVATE_RANGES_ONLY" # Direct VPC egress, spec §6.2 — no connector resource
    }

    containers {
      # Pinned to the commit-SHA tag manually built+pushed+deployed
      # (`gcloud run deploy`, out-of-band from Terraform) for the Admin Data
      # Import authentication rollout, 2026-09-01 — the previous tag here
      # predated all of this session's auth code, which is why an
      # unauthenticated adminImport.* call still returned real data before
      # this deploy. Update this alongside any future Terraform-driven
      # deploy of goms-api.
      image = "asia-south1-docker.pkg.dev/${var.project_id}/goms/goms-api:943b362b28dc9439fa0ed01aae49531cc9f2e1eb"
      env {
        name = "DATABASE_URL"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.goms_db_url.secret_id
            version = "latest"
          }
        }
      }
      # Admin Data Import redesign verification (plan Task 27) — goms-dev
      # only, per this plan's Global Constraints. goms-prod
      # (infra/prod/cloudrun.tf) stays unset until real auth exists.
      env {
        name  = "ADMIN_IMPORT_ENABLED"
        value = "true"
      }
      # Admin Data Import authentication (2026-09-01) — verifies a Firebase
      # ID token issued by the DEDICATED goms-dev-auth Firebase project
      # (deliberately not goms-prod's — see
      # docs/superpowers/plans/2026-09-01-goms-admin-import-firebase-auth-plan.md
      # Task 6) and checks its email against this allow-list. Neither value
      # is sensitive: FIREBASE_PROJECT_ID is a public project identifier,
      # and this is a roster of who may use the feature, not a credential —
      # same plain-env-var convention as ADMIN_IMPORT_ENABLED above.
      env {
        name  = "FIREBASE_PROJECT_ID"
        value = "goms-dev-auth" # the dev-only project, NOT goms-prod
      }
      env {
        name  = "ADMIN_IMPORT_ALLOWED_EMAILS"
        value = "rajas@amnex.com,rajassaji9@gmail.com"
      }
      # Lets a local frontend dev server (Task 28's Playwright lineage walk)
      # call this goms-dev API directly instead of through a hosted frontend
      # origin — apps/api/src/app.ts's DEFAULT_ALLOWED_ORIGINS only covers
      # localhost:5173, which may already be running a different local dev
      # server. goms-dev only; goms-prod's CORS allow-list is untouched.
      env {
        name  = "CORS_ALLOWED_ORIGINS"
        value = "http://localhost:5190"
      }
    }
  }
}

resource "google_cloud_run_v2_service_iam_member" "public_invoke" {
  name     = google_cloud_run_v2_service.goms_api.name
  location = "asia-south1"
  role     = "roles/run.invoker"
  member   = "allUsers" # spec §2/§15 — no auth at launch, deliberately
}

# Cloud SQL has no public IP (spec §6.2) and Cloud Shell has no network route
# into goms-vpc, so migrations can't be run with a local psql/node-pg-migrate
# client. This job reuses the API's own Direct VPC egress + DB secret to run
# them from inside the VPC instead -- `gcloud run jobs execute goms-migrate`
# for the initial schema and any future migration.
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
        # Kept in lockstep with goms_api's image above — updated to the same
        # auth-enabled build (2026-09-01) after running this job to apply
        # the actor_email migration via `gcloud run jobs update --image`
        # (out-of-band from Terraform, then reconciled here).
        image   = "asia-south1-docker.pkg.dev/${var.project_id}/goms/goms-api:943b362b28dc9439fa0ed01aae49531cc9f2e1eb"
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

# One-time seed of the frontend's reference/demo data into a fresh Postgres --
# same reasoning and same network path as goms_migrate above (no public
# Cloud SQL IP, so this must also run from inside goms_vpc), just a
# different image, since goms-api's own runtime image is deliberately
# minimal and doesn't carry the frontend src/ tree scripts/seed-import.ts
# needs. Image built from scripts/seed-import.Dockerfile (built+pushed
# manually the first time, same one-time-manual-push caveat
# google_cloud_run_v2_service.goms_api's own image tag already has above --
# CI does not build this image).
#
# Run once with: gcloud run jobs execute goms-seed-import --project=<id>
# --region=asia-south1. Safe to destroy afterward (`terraform destroy
# -target=google_cloud_run_v2_job.goms_seed_import`) -- it's a one-shot tool,
# not a standing service; nothing else references it.
resource "google_cloud_run_v2_job" "goms_seed_import" {
  name     = "goms-seed-import"
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
        image = "asia-south1-docker.pkg.dev/${var.project_id}/goms/goms-seed-import:bootstrap"
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
