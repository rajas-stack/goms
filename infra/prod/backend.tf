# Production Terraform state backend + provider (2026-08-26 Stage B
# production-readiness plan §5). Mirrors infra/dev/backend.tf structurally,
# with its own state bucket/prefix so dev and prod Terraform state are never
# shared or mixed.
#
# PREREQUISITES — none of this can be applied yet. In order:
#   1. The goms-prod GCP project is created and billing is linked (plan §7 —
#      a real, user-owned action; not done by this repo/session).
#   2. A `goms-prod-tfstate` GCS bucket exists (in goms-prod itself, or
#      another project reserved for Terraform state) — `terraform init` will
#      fail without it.
#   3. terraform.tfvars is filled in from terraform.tfvars.example in this
#      directory.
# Until then, only `terraform validate` and `terraform fmt` are meaningful
# here — `init`/`plan`/`apply` all require a real, reachable project.
terraform {
  backend "gcs" {
    bucket = "goms-prod-tfstate"
    prefix = "goms/prod"
  }
  required_providers {
    google = { source = "hashicorp/google", version = "~> 6.0" }
    random = { source = "hashicorp/random", version = "~> 3.6" } # for random_password in database.tf
  }
}

provider "google" {
  project = var.project_id
  region  = "asia-south1"
}
