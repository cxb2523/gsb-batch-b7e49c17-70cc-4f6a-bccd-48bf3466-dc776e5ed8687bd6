locals {
  public_ip = try(thalassa_loadbalancer.this.external_ip_addresses[0], null)
}

output "public_ip" {
  description = "The load balancer's public IP: point DNS here."
  value       = local.public_ip
}

output "ssh" {
  value = "ssh deploy@${coalesce(local.public_ip, "<public_ip>")}"
}

output "dns_records" {
  description = "Create these at the domain's DNS provider."
  value = {
    "*.${var.domain}" = "A ${coalesce(local.public_ip, "<public_ip>")}"
  }
}

output "loadbalancer_addresses" {
  description = "All addresses Thalassa reports for the load balancer, to check public_ip against."
  value = {
    ip_address            = thalassa_loadbalancer.this.ip_address
    external_ip_addresses = thalassa_loadbalancer.this.external_ip_addresses
  }
}
