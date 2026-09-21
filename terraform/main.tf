terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.5"
    }
  }
}

provider "aws" {
  region                      = var.aws_region
  skip_credentials_validation = true
  skip_requesting_account_id  = true
  skip_metadata_api_check     = true
}

# Core VPC & Subnets
module "vpc" {
  source             = "./modules/vpc"
  environment        = var.environment
  vpc_cidr           = var.vpc_cidr
  availability_zones = var.availability_zones
}

# Managed DocumentDB / MongoDB-compatible Database
module "database" {
  source             = "./modules/database"
  environment        = var.environment
  vpc_id             = module.vpc.vpc_id
  subnet_ids         = module.vpc.private_subnet_ids
  db_instance_class  = var.db_instance_class
  db_cluster_size    = var.db_cluster_size
  master_username    = var.db_master_username
  kms_key_arn        = module.vpc.kms_key_arn
  app_security_group_id = var.app_security_group_id
  documentdb_engine_version = var.documentdb_engine_version
  documentdb_deletion_protection = var.documentdb_deletion_protection
  documentdb_skip_final_snapshot = var.documentdb_skip_final_snapshot
  documentdb_final_snapshot_identifier = var.documentdb_final_snapshot_identifier
}

# Application Load Balancer & Ingress Security
module "alb" {
  source             = "./modules/alb"
  environment        = var.environment
  vpc_id             = module.vpc.vpc_id
  public_subnet_ids  = module.vpc.public_subnet_ids
  certificate_arn    = module.dns.certificate_arn
}

# Route53 DNS & ACM TLS Certificates
module "dns" {
  source      = "./modules/dns"
  domain_name = var.domain_name
  alb_dns_name = module.alb.alb_dns_name
  alb_zone_id  = module.alb.alb_zone_id
}
