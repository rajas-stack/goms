# infra/prod — Production GCP Terraform

**Status (2026-08-26):** Full skeleton written, `terraform validate` passes (via `init -backend=false`), **nothing applied**. `goms-prod` does not exist as a GCP project yet. Mirrors `infra/dev/*.tf`'s 7 files exactly in shape, with two deliberate deviations (no `goms-seed-import` job, no `allUsers` invoker grant) — see `cloudrun.tf`'s header comment for the reasoning. Built and reviewed per `docs/superpowers/analysis/2026-08-26-goms-stage-b-production-readiness-plan.md` §5.

## What must exist before `terraform apply` can run here at all

In order — each step blocks the next:

1. **`goms-prod` GCP project created, billing linked.** A real, user-owned action (billing account, org policy) — not something this repo or any automated process does on its own.
2. **A `goms-prod-tfstate` GCS bucket exists** (in `goms-prod` itself, or another project reserved for Terraform state). `terraform init` fails without it — see `backend.tf`'s header comment.
3. **`terraform.tfvars` filled in** from `terraform.tfvars.example` in this directory — `project_id`, `gitlab_project_path`, `notification_channel_ids`, `api_hostname`. The last two have no default on purpose (see `variables.tf`); `plan`/`apply` fails immediately and explicitly without them, rather than silently creating alert policies that page nobody.
4. **A production deploy trigger decision** — `wif.tf` currently stays identical to dev's (`ref == "main"`), on the reasoning that the real promotion gate should be a future `when: manual` CI stage, not a WIF-level ref restriction. If that reasoning is overridden, `wif.tf`'s `attribute_condition` needs a real edit before `apply`, not just a tfvars fill-in.

Until all four are true, only `terraform validate` and `terraform fmt -check` are meaningful here.

## Exact commands, once the above are met

```bash
cd infra/prod
terraform init                       # needs the real GCS bucket from step 2
terraform plan -out=tfplan           # review every resource it proposes to create — this is a brand-new environment, nothing to diff against
terraform apply tfplan
```

Run `terraform validate` any time before then — it doesn't need a real backend:

```bash
cd infra/prod
terraform init -backend=false
terraform validate
```

## What's deliberately NOT here

- **`goms-seed-import`** — dev's demo/reference-data importer. Confirmed absent from `cloudrun.tf`, and it stays that way; see `docs/superpowers/analysis/2026-08-26-goms-production-data-strategy-decision.md` for what prod's actual initial data load should be instead.
- **The `allUsers` Cloud Run invoker grant** — dev has one (a deliberate, already-shipped launch decision); prod does not, by design (see `cloudrun.tf`'s header comment). Named-principal access should be added explicitly, only when a concrete pre-cutover validator needs it.
- **A real `terraform.tfvars`** — only the `.example` is committed; the real file is gitignored (`infra/**/terraform.tfvars` in the repo root `.gitignore`) since it will hold a real project ID once one exists.

## Applying this is out of scope right now

This directory is prepared and internally consistent, not executed. Nothing here should be applied until `goms-prod` exists, billing is linked, the notification-channel and deploy-trigger decisions land, and the user explicitly approves a real `apply` — see the Stage B plan §7 checklist for the full remaining sequence.
