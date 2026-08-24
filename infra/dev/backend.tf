# Task 1.3 — Terraform state backend + provider.
#
# Terraform backend blocks cannot use variables or interpolation (a
# Terraform limitation, not a choice) — `bucket` below is the one literal
# placeholder in this whole infra/ tree. Replace it with the real dev
# project ID (plan §0.5 <GCP_PROJECT_ID_DEV>) before running `terraform
# init`; everywhere else in this tree uses var.project_id.
terraform {
  backend "gcs" {
    bucket = "<GCP_PROJECT_ID_DEV>-tfstate"
    prefix = "goms/dev"
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
