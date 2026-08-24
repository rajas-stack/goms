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

  template {
    service_account = google_service_account.goms_api_runtime.email
    scaling { min_instance_count = 0 } # spec §20 — accepted cold-start tradeoff

    vpc_access {
      network_interfaces {
        network    = google_compute_network.goms_vpc.id
        subnetwork = google_compute_subnetwork.goms_subnet.id
      }
      egress = "PRIVATE_RANGES_ONLY" # Direct VPC egress, spec §6.2 — no connector resource
    }

    containers {
      image = "asia-south1-docker.pkg.dev/${var.project_id}/goms/goms-api:bootstrap"
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
