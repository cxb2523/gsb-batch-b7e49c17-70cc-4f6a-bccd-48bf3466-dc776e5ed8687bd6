# One VM for the Falcon, reachable only through a load balancer.
#
# Thalassa cannot attach a public IP to a VM: inbound traffic goes through a
# load balancer, outbound through a NAT gateway. The load balancer passes TCP
# through unchanged, so Traefik on the VM terminates TLS itself.

# --- Network -----------------------------------------------------------------

resource "thalassa_vpc" "this" {
  name   = var.name
  region = var.region
  cidrs  = [var.vpc_cidr]
}

resource "thalassa_subnet" "this" {
  name   = var.name
  vpc_id = thalassa_vpc.this.id
  cidr   = var.subnet_cidr
}

# Outbound: apt, Docker images, Let's Encrypt, the data sources the pipelines
# fetch. The subnet uses the VPC's default route table.
resource "thalassa_natgateway" "this" {
  name      = var.name
  subnet_id = thalassa_subnet.this.id
}

data "thalassa_vpc_default_route_table" "this" {
  vpc_id = thalassa_vpc.this.id
}

resource "thalassa_route_table_route" "internet" {
  route_table_id    = data.thalassa_vpc_default_route_table.this.id
  destination_cidr  = "0.0.0.0/0"
  target_natgateway = thalassa_natgateway.this.id
}

# Only the load balancer, from inside the VPC, reaches the VM; nothing else
# comes in. Which outside sources may use a port is decided at the listener.
resource "thalassa_security_group" "vm" {
  name                     = "${var.name}-vm"
  vpc_id                   = thalassa_vpc.this.id
  allow_same_group_traffic = false

  dynamic "ingress_rule" {
    for_each = { ssh = 22, http = 80, https = 443 }
    content {
      name           = ingress_rule.key
      ip_version     = "ipv4"
      protocol       = "tcp"
      priority       = 100 + index(["ssh", "http", "https"], ingress_rule.key)
      remote_type    = "address"
      remote_address = var.vpc_cidr
      port_range_min = ingress_rule.value
      port_range_max = ingress_rule.value
      policy         = "allow"
    }
  }

  egress_rule {
    name           = "all"
    ip_version     = "ipv4"
    protocol       = "all"
    priority       = 100
    remote_type    = "address"
    remote_address = "0.0.0.0/0"
    policy         = "allow"
  }
}

# --- VM ----------------------------------------------------------------------

data "thalassa_volume_type" "block" {
  name = "Block"
}

resource "thalassa_virtual_machine_instance" "this" {
  name                = var.name
  subnet_id           = thalassa_subnet.this.id
  machine_type        = var.machine_type
  machine_image       = var.machine_image
  availability_zone   = var.availability_zone
  root_volume_size_gb = var.root_volume_size_gb
  root_volume_type    = data.thalassa_volume_type.block.id

  security_group_attachments = [thalassa_security_group.vm.id]

  cloud_init = templatefile("${path.module}/cloud-init.yaml", {
    ssh_public_key = trimspace(var.ssh_public_key)
  })

  # cloud-init runs once, at first boot: a changed script would replace the VM
  # and, with it, the lake on its disk. Apply script changes by hand instead.
  lifecycle {
    ignore_changes = [cloud_init]
  }

  # Outbound must work before cloud-init installs packages.
  depends_on = [thalassa_route_table_route.internet]
}

# --- Load balancer -------------------------------------------------------------

# The load balancer's public IP is the platform's address: it stays as long as
# the load balancer does, also when the VM is replaced. (A reserved IP would
# outlive the load balancer too, but Thalassa does not offer reserved IPs to
# every organisation.)
resource "thalassa_loadbalancer" "this" {
  name      = var.name
  region    = var.region
  subnet_id = thalassa_subnet.this.id
}

locals {
  # port => sources allowed to reach it
  listeners = {
    22  = var.allowed_ssh_sources
    80  = ["0.0.0.0/0"]
    443 = ["0.0.0.0/0"]
  }
}

resource "thalassa_target_group" "this" {
  for_each = local.listeners

  name     = "${var.name}-${each.key}"
  vpc_id   = thalassa_vpc.this.id
  protocol = "tcp"
  port     = each.key

  # Thalassa's default, written out: left unset, the API fills it in and every
  # plan afterwards wants to set it back to null. With one VM the policy
  # itself makes no difference.
  loadbalancing_policy = "ROUND_ROBIN"

  # No health check settings: as soon as one is set, the provider sends a full
  # health check with an empty path, which the API rejects even for TCP. With
  # a single VM there is nothing to fail over to anyway.
}

resource "thalassa_target_group_attachment" "this" {
  for_each = local.listeners

  target_group_id = thalassa_target_group.this[each.key].id
  vmi_id          = thalassa_virtual_machine_instance.this.id
}

resource "thalassa_loadbalancer_listener" "this" {
  for_each = local.listeners

  name            = "${var.name}-${each.key}"
  loadbalancer_id = thalassa_loadbalancer.this.id
  protocol        = "tcp"
  port            = each.key
  target_group_id = thalassa_target_group.this[each.key].id
  allowed_sources = each.value
}
