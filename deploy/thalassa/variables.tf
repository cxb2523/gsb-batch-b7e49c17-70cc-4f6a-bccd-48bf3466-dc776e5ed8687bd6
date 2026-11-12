variable "name" {
  description = "Prefix for every resource name. Security group names may be at most 16 characters, so keep it short."
  type        = string
  default     = "falcon"

  validation {
    condition     = length(var.name) <= 13
    error_message = "name may be at most 13 characters (the security group name adds \"-vm\")."
  }
}

variable "domain" {
  description = "Domain the services run under: dagster.<domain>, crowsnest.<domain>, marimo.<domain>, apps.<domain>."
  type        = string
}

variable "ssh_public_key" {
  description = "Public key (the contents of ~/.ssh/id_ed25519.pub) for the deploy user."
  type        = string
}

variable "allowed_ssh_sources" {
  description = "CIDRs allowed to reach SSH through the load balancer, e.g. [\"203.0.113.7/32\"]."
  type        = list(string)

  validation {
    condition     = length(var.allowed_ssh_sources) > 0 && !contains(var.allowed_ssh_sources, "0.0.0.0/0")
    error_message = "Give at least one source, and not 0.0.0.0/0: SSH is not for the whole internet."
  }
}

variable "machine_image" {
  description = "Ubuntu image name or slug as the Thalassa console lists it (Compute > Machine images)."
  type        = string
}

variable "machine_type" {
  description = "pgp-* for production, dgp-* for test. Dagster, dbt and DuckDB want at least 4 GB."
  type        = string
  default     = "pgp-medium"
}

variable "root_volume_size_gb" {
  description = "Root disk. The lake lives here (see README), so leave room for it to grow."
  type        = number
  default     = 40
}

variable "region" {
  type    = string
  default = "nl-01"
}

variable "availability_zone" {
  type    = string
  default = "nl-01a"
}

variable "vpc_cidr" {
  type    = string
  default = "10.20.0.0/16"
}

variable "subnet_cidr" {
  type    = string
  default = "10.20.1.0/24"
}
