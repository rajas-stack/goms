# infra/dev — Dev GCP Terraform

**Status (2026-08-26):** `goms-dev` is a real, applied environment — `network.tf`, `database.tf`, `storage.tf`, `cloudrun.tf`, `wif.tf` have all been applied and are live (Stage A of the cutover, accepted complete). **`monitoring.tf` is the one exception** — written and `terraform validate`-clean, but **not yet applied**, gated on the same missing decision as prod's copy (see below). `terraform.tfvars` (real values, gitignored) already exists for this directory.

## What's still needed before `monitoring.tf` specifically can be applied

Everything else in this directory is already live — this is the only outstanding gap:

1. **Who gets paged, and how** (email address or Slack webhook) — `notification_channel_ids` (`variables.tf`) has no default on purpose, so `plan`/`apply` fails explicitly rather than silently creating alert policies that page nobody. Once a real recipient is decided, create the corresponding `google_monitoring_notification_channel` resource (not currently in this directory — deliberately not guessed at) and reference its ID here.
2. **`api_hostname`** — the uptime check's probe target. For `goms-dev` today this is `goms-api`'s own `*.run.app` host (see `2026-08-26-goms-dev-remote-cutover-checkpoint.md` for the current live value). Fill this into `terraform.tfvars` alongside the notification channel IDs.

## Exact commands, once both are filled into `terraform.tfvars`

```bash
cd infra/dev
terraform init
terraform plan -out=tfplan   # review — this environment is otherwise already live, so the diff should show only monitoring.tf's new resources
terraform apply tfplan
```

`terraform validate` needs no real values and already passes:

```bash
cd infra/dev
terraform init -backend=false
terraform validate
```

## Why dev gets monitoring too, not just prod

This is infra, not a prod-only concern — dev should get the same cheap visibility (Stage B plan §3.2), and applying it here first is also the natural rehearsal for applying the identical `infra/prod/monitoring.tf` once `goms-prod` exists.
