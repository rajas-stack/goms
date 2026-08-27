# Mirrors infra/dev/network.tf exactly — VPC, subnet, Private Services
# Access for Cloud SQL's private IP. GCP networking is project-scoped, so
# this must be a real (not shared) copy in goms-prod; nothing here can be
# applied until goms-prod exists (see backend.tf's prerequisites).

resource "google_compute_network" "goms_vpc" {
  name                    = "goms-vpc"
  auto_create_subnetworks = false
}

resource "google_compute_subnetwork" "goms_subnet" {
  name          = "goms-subnet-asia-south1"
  ip_cidr_range = "10.10.0.0/24"
  region        = "asia-south1"
  network       = google_compute_network.goms_vpc.id
}

resource "google_compute_global_address" "goms_psa_range" {
  name          = "goms-psa-range"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 20
  network       = google_compute_network.goms_vpc.id
}

resource "google_service_networking_connection" "goms_psa" {
  network                 = google_compute_network.goms_vpc.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.goms_psa_range.name]
}
