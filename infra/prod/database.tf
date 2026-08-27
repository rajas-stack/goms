# Mirrors infra/dev/database.tf exactly — same db-f1-micro tier, no HA, no
# public IP, PITR enabled. Stage B plan §5: prod does NOT get a bigger tier
# by default (matches the cost-sensitive framing already established for
# this project) — size up only on an explicit, separate decision once real
# prod traffic exists, not as part of standing the environment up.

resource "google_sql_database_instance" "goms_pg" {
  name             = "goms-pg"
  region           = "asia-south1"
  database_version = "POSTGRES_16"
  depends_on       = [google_service_networking_connection.goms_psa]

  settings {
    edition           = "ENTERPRISE"  # required for db-f1-micro -- ENTERPRISE_PLUS (now GCP's default for new instances) rejects shared-core tiers
    tier              = "db-f1-micro" # smallest shared-core tier, single zone — matches dev; revisit only on an explicit prod-sizing decision
    availability_type = "ZONAL"
    ip_configuration {
      ipv4_enabled    = false # no public IP
      private_network = google_compute_network.goms_vpc.id
    }
    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true # required for the rollback runbook's PITR path — see docs/superpowers/analysis/goms-prod-rollback-runbook.md
    }
  }
  deletion_protection = true
}

resource "google_sql_database" "goms" {
  name     = "goms"
  instance = google_sql_database_instance.goms_pg.name
}

resource "random_password" "goms_db_password" {
  length  = 32
  special = false
}

resource "google_sql_user" "goms_app" {
  name     = "goms_app"
  instance = google_sql_database_instance.goms_pg.name
  password = random_password.goms_db_password.result
}

resource "google_secret_manager_secret" "goms_db_password" {
  secret_id = "goms-db-password"
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "goms_db_password" {
  secret      = google_secret_manager_secret.goms_db_password.id
  secret_data = random_password.goms_db_password.result
}

resource "google_secret_manager_secret" "goms_db_url" {
  secret_id = "goms-db-url"
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "goms_db_url" {
  secret      = google_secret_manager_secret.goms_db_url.id
  secret_data = "postgresql://goms_app:${random_password.goms_db_password.result}@${google_sql_database_instance.goms_pg.private_ip_address}:5432/goms"
}
