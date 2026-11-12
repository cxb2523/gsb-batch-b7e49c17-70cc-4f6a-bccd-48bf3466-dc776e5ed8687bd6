terraform {
  required_version = ">= 1.8"

  required_providers {
    thalassa = {
      source  = "thalassa-cloud/thalassa"
      version = "~> 0.27"
    }
  }
}

# No provider block: this is a module, and the configuration that calls it
# configures the provider (see README).
