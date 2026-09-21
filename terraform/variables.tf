variable "aws_region" {
  type        = string
  description = "AWS deployment region"
  default     = "ap-south-1"
}

variable "environment" {
  type        = string
  description = "Environment identifier (e.g. production, staging)"
  default     = "production"
}

variable "vpc_cidr" {
  type        = string
  description = "CIDR block for the VPC"
  default     = "10.0.0.0/16"
}

variable "availability_zones" {
  type        = list(string)
  description = "List of availability zones"
  default     = ["ap-south-1a", "ap-south-1b", "ap-south-1c"]
}

variable "domain_name" {
  type        = string
  description = "Primary domain for the financial advisory platform"
}

variable "db_instance_class" {
  type        = string
  description = "Instance class for DocumentDB cluster instances"
  default     = "db.r6g.large"
}

variable "db_cluster_size" {
  type        = number
  description = "Number of cluster instances for high availability"
  default     = 2
}

variable "db_master_username" {
  type        = string
  description = "Master administrator username for DocumentDB"
  default     = "wealthgenie_admin"
}

variable "documentdb_engine_version" {
  type        = string
  description = "Explicit Amazon DocumentDB engine version; provide a version supported by the target region."
}

variable "documentdb_deletion_protection" {
  type        = bool
  description = "Protect the DocumentDB cluster from accidental deletion. Keep enabled for production."
  default     = true
}

variable "documentdb_skip_final_snapshot" {
  type        = bool
  description = "Skip the final DocumentDB snapshot only for explicitly disposable environments."
  default     = false
}

variable "documentdb_final_snapshot_identifier" {
  type        = string
  description = "Optional final snapshot identifier. A unique deterministic-per-state identifier is generated when omitted."
  default     = null
  nullable    = true
}

variable "app_security_group_id" {
  type        = string
  description = "Security group for the actual application workload that connects to DocumentDB. This stack does not provision compute."
  default     = null
  nullable    = true
}
