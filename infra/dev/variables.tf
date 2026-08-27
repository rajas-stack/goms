variable "project_id" {
  description = "GCP dev project ID (plan §0.5 <GCP_PROJECT_ID_DEV>)"
  type        = string
}

variable "gitlab_project_path" {
  description = "GitLab namespace/path, e.g. group/goms (plan §0.5 <GITLAB_PROJECT>)"
  type        = string
}

# Stage B — monitoring (2026-08-26 production-readiness plan §3). Both below
# are deliberately required, with no default:
#
# - notification_channel_ids: who gets paged is an explicit open decision
#   (plan §7) — an empty-list default would let `terraform apply` silently
#   create alert policies that page nobody, which is worse than an error
#   that makes the missing decision impossible to miss.
# - api_hostname: the uptime check's probe target. For goms-dev today this is
#   goms-api's own `*.run.app` host (see the 2026-08-26 dev cutover checkpoint
#   for the current value); once Stage B §6 (Firebase Hosting) ships, this
#   becomes the Hosting domain instead — a config change, not a resource
#   change, since the uptime check just probes whatever host is passed in.
variable "notification_channel_ids" {
  description = "Monitoring notification channel IDs to page on alert. No default — see comment above."
  type        = list(string)
}

variable "api_hostname" {
  description = "Hostname the uptime check probes (no scheme, no path) — goms-api's *.run.app host today. No default — see comment above."
  type        = string
}
