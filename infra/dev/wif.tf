# Phase 7 — Workload Identity Federation for GitLab CI (no long-lived keys).

resource "google_iam_workload_identity_pool" "gitlab_pool" {
  workload_identity_pool_id = "gitlab-pool"
}

resource "google_iam_workload_identity_pool_provider" "gitlab_oidc" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.gitlab_pool.workload_identity_pool_id
  workload_identity_pool_provider_id = "gitlab-oidc"
  attribute_mapping = {
    "google.subject"         = "assertion.sub"
    "attribute.project_path" = "assertion.project_path"
    "attribute.ref"          = "assertion.ref"
  }
  # Restrict to this exact GitLab project and branch — not any GitLab
  # project, not any ref.
  attribute_condition = "assertion.project_path == \"${var.gitlab_project_path}\" && assertion.ref == \"refs/heads/main\""
  oidc {
    issuer_uri = "https://gitlab.com"
  }
}

resource "google_service_account" "goms_ci_deploy" {
  account_id   = "goms-ci-deploy"
  display_name = "GitLab CI deploy (WIF, no keys)"
}

resource "google_service_account_iam_member" "wif_binding" {
  service_account_id = google_service_account.goms_ci_deploy.name
  role                = "roles/iam.workloadIdentityUser"
  member              = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.gitlab_pool.name}/attribute.project_path/${var.gitlab_project_path}"
}

# Deploy SA's own permissions — deploy + push image + act-as runtime SA,
# nothing broader.
resource "google_project_iam_member" "deploy_run_admin" {
  project = var.project_id
  role    = "roles/run.admin"
  member  = "serviceAccount:${google_service_account.goms_ci_deploy.email}"
}

resource "google_project_iam_member" "deploy_artifact_writer" {
  project = var.project_id
  role    = "roles/artifactregistry.writer"
  member  = "serviceAccount:${google_service_account.goms_ci_deploy.email}"
}

resource "google_service_account_iam_member" "deploy_actas_runtime" {
  service_account_id = google_service_account.goms_api_runtime.name
  role                = "roles/iam.serviceAccountUser"
  member              = "serviceAccount:${google_service_account.goms_ci_deploy.email}"
}
