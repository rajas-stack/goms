# Stage B — monitoring/alerts (2026-08-26 production-readiness plan §3).
# Applies to goms-dev. infra/prod/monitoring.tf mirrors this file exactly
# once goms-prod exists (not created yet — plan §5/§7); the only difference
# between the two is which project/tfvars they're applied against.
#
# Deliberately NOT included: a google_monitoring_notification_channel
# resource. Who gets paged and how (email vs. Slack) is an open decision
# (plan §7) — inventing a recipient here would be worse than not alerting at
# all, since it creates false confidence that someone is watching. Both
# alert policies below reference var.notification_channel_ids, which has no
# default (variables.tf), so `terraform plan`/`apply` fails loudly and
# explicitly until that list is supplied — not silently wired to nobody.

resource "google_monitoring_uptime_check_config" "goms_api_health" {
  display_name = "goms-api health"
  timeout      = "10s"
  period       = "60s"

  http_check {
    path         = "/api/trpc/health.check"
    port         = 443
    use_ssl      = true
    validate_ssl = true
  }

  monitored_resource {
    type = "uptime_url"
    labels = {
      project_id = var.project_id
      host       = var.api_hostname
    }
  }
}

# health.check does a real `SELECT 1` against Cloud SQL and only returns
# {ok:true, db:"connected"} on success — a DB-connectivity failure surfaces
# as a thrown error, which tRPC's fastify adapter maps to a 5xx response, not
# a 200. The uptime check's default "success = 2xx" behavior therefore
# already verifies DB connectivity end-to-end; no separate DB-specific probe
# or content matcher is needed.
resource "google_monitoring_alert_policy" "goms_api_down" {
  display_name = "goms-api uptime check failing"
  combiner     = "OR"

  conditions {
    display_name = "Uptime check failed"
    condition_threshold {
      filter = join(" AND ", [
        "metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\"",
        "resource.type=\"uptime_url\"",
        "metric.label.\"check_id\"=\"${google_monitoring_uptime_check_config.goms_api_health.uptime_check_id}\"",
      ])
      comparison      = "COMPARISON_LT"
      threshold_value = 1
      # 2 consecutive failed 60s checks (duration must be >= one check
      # period past the first failure) before paging — long enough to avoid
      # single-blip false alarms, short enough that real downtime pages fast.
      duration = "120s"
      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_NEXT_OLDER"
      }
    }
  }

  notification_channels = var.notification_channel_ids
}

resource "google_monitoring_alert_policy" "goms_pg_cpu" {
  display_name = "goms-pg CPU utilization > 80%"
  combiner     = "OR"

  conditions {
    display_name = "CPU utilization"
    condition_threshold {
      filter = join(" AND ", [
        "resource.type=\"cloudsql_database\"",
        "resource.labels.database_id=\"${var.project_id}:${google_sql_database_instance.goms_pg.name}\"",
        "metric.type=\"cloudsql.googleapis.com/database/cpu/utilization\"",
      ])
      comparison      = "COMPARISON_GT"
      threshold_value = 0.8
      duration        = "300s"
      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_MEAN"
      }
    }
  }

  notification_channels = var.notification_channel_ids
}

resource "google_monitoring_alert_policy" "goms_pg_storage" {
  display_name = "goms-pg storage utilization > 80%"
  combiner     = "OR"

  conditions {
    display_name = "Storage utilization"
    condition_threshold {
      filter = join(" AND ", [
        "resource.type=\"cloudsql_database\"",
        "resource.labels.database_id=\"${var.project_id}:${google_sql_database_instance.goms_pg.name}\"",
        "metric.type=\"cloudsql.googleapis.com/database/disk/utilization\"",
      ])
      comparison      = "COMPARISON_GT"
      threshold_value = 0.8
      duration        = "300s"
      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_MEAN"
      }
    }
  }

  notification_channels = var.notification_channel_ids
}

resource "google_monitoring_alert_policy" "goms_pg_connections" {
  display_name = "goms-pg connection count high"
  combiner     = "OR"

  conditions {
    display_name = "Connection count"
    condition_threshold {
      filter = join(" AND ", [
        "resource.type=\"cloudsql_database\"",
        "resource.labels.database_id=\"${var.project_id}:${google_sql_database_instance.goms_pg.name}\"",
        "metric.type=\"cloudsql.googleapis.com/database/postgresql/num_backends\"",
      ])
      comparison = "COMPARISON_GT"
      # db-f1-micro's connection ceiling is small (shared-core tier) — 20 is
      # a conservative starting threshold meant to alert before the app
      # actually starts seeing connection errors, not a verified exact limit.
      # Revisit against the instance's real max_connections flag once traffic
      # exists.
      threshold_value = 20
      duration        = "300s"
      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_MEAN"
      }
    }
  }

  notification_channels = var.notification_channel_ids
}
