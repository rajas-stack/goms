# Alert on audit failures and repeated denied access without recording secrets.
resource "google_logging_metric" "goms_security_failures" {
  name   = "goms-security-failures"
  filter = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"goms-api\" AND (jsonPayload.event=~\"^security[.]\" OR textPayload:\"security.\")"
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
  }
}
resource "google_monitoring_alert_policy" "goms_security_failures" {
  display_name = "GOMS repeated security failures"
  combiner     = "OR"
  conditions {
    display_name = "More than ten security failures per minute"
    condition_threshold {
      filter          = "resource.type=\"cloud_run_revision\" AND metric.type=\"logging.googleapis.com/user/${google_logging_metric.goms_security_failures.name}\""
      comparison      = "COMPARISON_GT"
      threshold_value = 10
      duration        = "60s"
      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_SUM"
      }
    }
  }
  notification_channels = var.notification_channel_ids
}

resource "google_logging_metric" "goms_audit_failures" {
  name   = "goms-audit-failures"
  filter = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"goms-api\" AND (jsonPayload.event=~\"^security[.](audit|portal_audit)\" OR textPayload:\"security.audit\" OR textPayload:\"security.portal_audit\")"
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
  }
}
resource "google_monitoring_alert_policy" "goms_audit_failures" {
  display_name = "GOMS security audit unavailable"
  combiner     = "OR"
  conditions {
    display_name = "Security audit failure"
    condition_threshold {
      filter          = "resource.type=\"cloud_run_revision\" AND metric.type=\"logging.googleapis.com/user/${google_logging_metric.goms_audit_failures.name}\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "0s"
      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_SUM"
      }
    }
  }
  notification_channels = var.notification_channel_ids
}
