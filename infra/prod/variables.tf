variable "project_id" {
  description = "GCP prod project ID (goms-prod) — not created yet, Stage B plan §7"
  type        = string
}

variable "gitlab_project_path" {
  description = "GitLab namespace/path, e.g. group/goms — same repo as dev. deploy-prod (a future .gitlab-ci.yml stage, out of scope for this pass — see Stage B plan §5's task list) is expected to reuse this same WIF identity/provider gated by a `when: manual` CI step, not a different git ref, so this value matches infra/dev's exactly."
  type        = string
}

# Stage B — monitoring (2026-08-26 production-readiness plan §3/§7). Both
# required, no default on purpose — mirrors infra/dev/variables.tf's same
# reasoning: an empty-list/guessed default would let `apply` silently create
# alert policies that page nobody, or probe a host that doesn't exist yet.
variable "notification_channel_ids" {
  description = "Monitoring notification channel IDs to page on alert. No default — recipient not yet decided."
  type        = list(string)
}

variable "api_hostname" {
  description = "Hostname the uptime check probes (no scheme, no path) — goms-api's *.run.app host once the prod Cloud Run service exists, or the prod Firebase Hosting domain once plan §6 ships. No default — neither exists yet."
  type        = string
}
variable "admin_allowed_emails" {
  description = "Verified Amnex Google identities authorized to administer GOMS. Required before enforcing RBAC."
  type        = list(string)
  validation {
    condition     = length(var.admin_allowed_emails) > 0 && alltrue([for email in var.admin_allowed_emails : endswith(lower(email), "@amnex.com")])
    error_message = "Provide at least one administrator with an @amnex.com Google identity."
  }
}
variable "api_image" {
  description = "Validated security release image, pinned by immutable Artifact Registry digest."
  type        = string
  validation {
    condition     = can(regex("^asia-south1-docker[.]pkg[.]dev/[^/]+/goms/goms-api@sha256:[a-f0-9]{64}$", var.api_image))
    error_message = "Provide the tested goms-api image with an immutable sha256 digest."
  }
}
