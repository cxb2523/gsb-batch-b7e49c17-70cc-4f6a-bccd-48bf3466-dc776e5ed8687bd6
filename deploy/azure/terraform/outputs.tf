output "admin_username" {
  value = local.admin
}

output "nodes" {
  description = "Nodos worker, en orden (w1, w2, ...)"
  value = [for i, vm in azurerm_linux_virtual_machine.node : {
    name      = "w${i + 1}"
    public_ip = azurerm_public_ip.node[i].ip_address
  }]
}
