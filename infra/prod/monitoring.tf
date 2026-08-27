# Mirrors infra/dev/monitoring.tf exactly — same alert policies, same
# reasoning (see that file's header comment). Applied to a different
# project/tfvars only; the resource definitions themselves have no
# dev/prod-specific content.

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
      duration        = "120s"
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
      comparison      = "COMPARISON_GT"
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
