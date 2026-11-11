# Nodos worker de SentriX en Azure for Students para la prueba de escalamiento horizontal.
# No contiene secretos: la clave de Tailscale y las de la base se envían después por SSH (ver preparar_nodos.py).
terraform {
  required_version = ">= 1.6"
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
  }
}

provider "azurerm" {
  features {}
  subscription_id = var.subscription_id
  # Compute y Network ya están registrados; registrar más proveedores no es necesario y la cuenta podría rechazarlo.
  resource_provider_registrations = "none"
}

locals {
  admin = "sentrix"
  tags  = { proyecto = "sentrix", uso = "prueba-escalamiento" }
}

resource "azurerm_resource_group" "rg" {
  name     = var.resource_group
  location = var.location
  tags     = local.tags
}

resource "azurerm_virtual_network" "net" {
  name                = "sx-net"
  address_space       = ["10.20.0.0/16"]
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
  tags                = local.tags
}

resource "azurerm_subnet" "workers" {
  name                 = "workers"
  resource_group_name  = azurerm_resource_group.rg.name
  virtual_network_name = azurerm_virtual_network.net.name
  address_prefixes     = ["10.20.1.0/24"]
}

resource "azurerm_network_security_group" "nsg" {
  name                = "sx-nsg"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
  tags                = local.tags

  security_rule {
    name                       = "ssh-solo-desde-mi-ip"
    priority                   = 100
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "22"
    source_address_prefix      = var.allowed_ssh_cidr
    destination_address_prefix = "*"
  }

  # Puerto de WireGuard de Tailscale: facilita la conexión directa. Sin él podría ir por un relay y falsear la latencia.
  security_rule {
    name                       = "tailscale-directo"
    priority                   = 110
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Udp"
    source_port_range          = "*"
    destination_port_range     = "41641"
    source_address_prefix      = "Internet"
    destination_address_prefix = "*"
  }
}

resource "azurerm_subnet_network_security_group_association" "workers" {
  subnet_id                 = azurerm_subnet.workers.id
  network_security_group_id = azurerm_network_security_group.nsg.id
}

resource "azurerm_public_ip" "node" {
  count               = var.node_count
  name                = "sx-w${count.index + 1}-ip"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
  allocation_method   = "Static"
  sku                 = "Standard"
  tags                = local.tags
}

resource "azurerm_network_interface" "node" {
  count               = var.node_count
  name                = "sx-w${count.index + 1}-nic"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
  tags                = local.tags

  ip_configuration {
    name                          = "principal"
    subnet_id                     = azurerm_subnet.workers.id
    private_ip_address_allocation = "Dynamic"
    public_ip_address_id          = azurerm_public_ip.node[count.index].id
  }
}

resource "azurerm_linux_virtual_machine" "node" {
  count                 = var.node_count
  name                  = "sx-w${count.index + 1}"
  location              = azurerm_resource_group.rg.location
  resource_group_name   = azurerm_resource_group.rg.name
  size                  = var.vm_size
  admin_username        = local.admin
  network_interface_ids = [azurerm_network_interface.node[count.index].id]
  custom_data           = base64encode(file("${path.module}/cloud-init.yaml"))
  tags                  = local.tags

  admin_ssh_key {
    username   = local.admin
    public_key = file(pathexpand(var.ssh_public_key_path))
  }

  os_disk {
    caching              = "ReadWrite"
    storage_account_type = "Standard_LRS"
  }

  source_image_reference {
    publisher = "Canonical"
    offer     = "ubuntu-24_04-lts"
    sku       = "server"
    version   = "latest"
  }
}
