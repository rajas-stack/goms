# Mirrors infra/dev/wif.tf exactly — Workload Identity Federation for GitLab
# CI, no long-lived keys. A separate pool/provider/deploy-SA per project
# (never shared across dev/prod), matching the project-level isolation
# principle from the architecture doc §16.
#
# Stage B plan §5 flagged an open question here: does deploy-prod use a
# different git ref/trigger than deploy-dev? On reflection, it doesn't need
# to at the WIF layer — the attribute_condition below only controls which
# git ref may assume the goms-ci-deploy identity at all, not when a deploy
# actually runs. The real promotion control is a future `deploy-prod` stage
# in .gitlab-ci.yml gated `when: manual` (architecture doc §18) — same ref,
# same image tag already validated in dev, promoted only on an explicit
# human click. That CI stage is out of scope for this pass (Stage B task
# list: "do not redesign CI" while the shared-runner quota is exhausted) —
# not added here.

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
  attribute_condition = "assertion.project_path == \"${var.gitlab_project_path}\" && assertion.ref == \"main\""
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
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.gitlab_pool.name}/attribute.project_path/${var.gitlab_project_path}"
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
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.goms_ci_deploy.email}"
}
