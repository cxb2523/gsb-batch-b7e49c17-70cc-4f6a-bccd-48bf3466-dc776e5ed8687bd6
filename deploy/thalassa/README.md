# A VM for the Falcon on Thalassa Cloud

OpenTofu configuration for one Ubuntu VM with Docker, ready for the Falcon's Compose stack
(`deploy/compose`).

```
internet ──> load balancer (public IP) ──┬─ :22  (your IP only) ─┐
                                             ├─ :80                   ├──> VM (Docker, Traefik)
                                             └─ :443                  ┘
VM ──> NAT gateway ──> internet   (apt, images, Let's Encrypt, data sources)
```

Thalassa cannot attach a public IP to a VM, so inbound traffic goes through a load balancer that
passes TCP through unchanged; Traefik on the VM terminates TLS. The VM's security group accepts
22, 80 and 443 from inside the VPC only. The public IP is the load balancer's, so it stays the same when
the VM is replaced, but not when the load balancer is.

## What it costs

A VM, a load balancer and a NAT gateway. See Thalassa's pricing page.

## Using it

This directory is a module: it creates the resources but does not configure the provider or keep
state. Each customer gets a directory of its own, outside this repository, that calls the module
with its values and holds its state:

```hcl
# infra/<customer>/main.tf
terraform {
  required_providers {
    thalassa = {
      source  = "thalassa-cloud/thalassa"
      version = "~> 0.27"
    }
  }
}

provider "thalassa" {}

module "falcon" {
  source = "git::https://github.com/datavloot/datavloot-toolkit.git//deploy/thalassa?ref=<tag or commit>"

  domain              = "falcon.example.nl"
  machine_image       = "ubuntu-24.04-63bcc0086f12" # as the console lists it under Machine images
  ssh_public_key      = "ssh-ed25519 AAAA... you@laptop"
  allowed_ssh_sources = ["203.0.113.7/32"]          # your own IP: curl ifconfig.me
}

output "public_ip"   { value = module.falcon.public_ip }
output "ssh"         { value = module.falcon.ssh }
output "dns_records" { value = module.falcon.dns_records }
```

Ignore `*.tfstate*` and `.terraform/` there; commit `.terraform.lock.hcl`.

1. Install OpenTofu (Windows: `winget install --exact --id=OpenTofu.Tofu`) and open a new terminal.
2. In the Thalassa console, create an API token. Put it, and your organisation, in the environment
   of the terminal you run OpenTofu from, never in a file:

   ```powershell
   $env:THALASSA_API_TOKEN = "<token>"
   $env:THALASSA_ORGANISATION = "<organisation id or slug>"
   ```

3. From the customer's directory:

   ```
   tofu init      # downloads the module and the Thalassa provider
   tofu plan      # shows what will be created; nothing happens yet
   tofu apply     # creates it, after you type yes
   ```

4. Create the DNS records `tofu output dns_records` lists, at the domain's DNS provider.
5. Wait a few minutes for cloud-init (packages, Docker), then `tofu output ssh` gives the command
   to log in. `cloud-init status --wait` on the VM tells you when it is done.

## Changing things

`tofu plan` before every `apply`, and read it: a change marked `-/+` (replace) on the VM throws
away its disk, and with it the lake. Changing the machine type does that.

cloud-init runs only at first boot, so changes to `cloud-init.yaml` are ignored on an existing VM;
apply them by hand, or replace the VM on purpose with `tofu apply -replace=module.falcon.thalassa_virtual_machine_instance.this`.

`name` (default `falcon`) prefixes every resource. Changing it on an existing VM renames, and may
replace, the VM and the load balancer; set it once and keep it.

## Not here yet

- The lake lives on the VM's root disk. Replacing the VM loses it until backups (#17) exist.
- State is local, in the customer's directory. Whoever applies keeps it; losing it means OpenTofu
  no longer knows what it created. Move it to object storage once more people apply.
- DNS is not managed here.

## Removing everything

`tofu destroy` removes everything this configuration created. A new `apply` gets a new load
balancer with a different IP, so DNS has to change too.
