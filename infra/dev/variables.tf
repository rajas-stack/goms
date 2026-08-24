variable "project_id" {
  description = "GCP dev project ID (plan §0.5 <GCP_PROJECT_ID_DEV>)"
  type        = string
}

variable "gitlab_project_path" {
  description = "GitLab namespace/path, e.g. group/goms (plan §0.5 <GITLAB_PROJECT>)"
  type        = string
}
