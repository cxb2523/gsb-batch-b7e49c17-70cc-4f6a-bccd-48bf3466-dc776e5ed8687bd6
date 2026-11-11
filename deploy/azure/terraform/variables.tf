variable "subscription_id" {
  description = "Id de la suscripción Azure for Students"
  type        = string
}

variable "allowed_ssh_cidr" {
  description = "Tu IP pública con /32: solo ella puede entrar por SSH"
  type        = string

  validation {
    condition     = can(cidrhost(var.allowed_ssh_cidr, 0)) && var.allowed_ssh_cidr != "0.0.0.0/0"
    error_message = "Usa tu IP pública con /32; 0.0.0.0/0 abriría SSH a todo internet."
  }
}

variable "ssh_public_key_path" {
  description = "Llave pública para entrar a los nodos"
  type        = string
  default     = "~/.ssh/sentrix_azure.pub"
}

variable "location" {
  description = "Región permitida por Azure for Students más cercana a AWS us-east-2 (Ohio). East US 2 no está permitida"
  type        = string
  default     = "northcentralus"
}

variable "resource_group" {
  description = "Grupo que contiene todo: borrarlo elimina la prueba completa"
  type        = string
  default     = "sentrix-escalamiento"
}

variable "node_count" {
  description = "Cantidad de workers. La cuota es de 6 vCPU por región: máximo 3 nodos de 2 vCPU"
  type        = number
  default     = 3

  validation {
    condition     = var.node_count >= 1 && var.node_count <= 3
    error_message = "Con la cuota de 6 vCPU por región caben de 1 a 3 nodos de 2 vCPU."
  }
}

variable "vm_size" {
  description = "2 vCPU y 8 GB. La cuenta solo tiene cuota de serie B v2: base 0,8 núcleo, por encima usa créditos de CPU"
  type        = string
  default     = "Standard_B2as_v2"
}
