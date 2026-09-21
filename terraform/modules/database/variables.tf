variable "environment" { type = string }
variable "vpc_id" { type = string }
variable "subnet_ids" { type = list(string) }
variable "db_instance_class" { type = string }
variable "db_cluster_size" { type = number }
variable "master_username" { type = string }
variable "kms_key_arn" { type = string }
variable "app_security_group_id" {
  type        = string
  description = "Application workload security group. Null leaves ingress closed until compute wiring is supplied."
  default     = null
  nullable    = true
}
variable "documentdb_engine_version" {
  type = string
}

variable "documentdb_deletion_protection" {
  type    = bool
  default = true
}

variable "documentdb_skip_final_snapshot" {
  type    = bool
  default = false
}

variable "documentdb_final_snapshot_identifier" {
  type     = string
  default  = null
  nullable = true
}
