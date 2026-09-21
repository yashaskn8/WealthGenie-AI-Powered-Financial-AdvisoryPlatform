resource "random_password" "master_password" {
  length  = 32
  special = false
}

resource "random_id" "final_snapshot_suffix" {
  byte_length = 4
}

locals {
  final_snapshot_identifier = var.documentdb_final_snapshot_identifier != null
    ? var.documentdb_final_snapshot_identifier
    : "wealthgenie-${var.environment}-final-${random_id.final_snapshot_suffix.hex}"
}

resource "aws_docdb_subnet_group" "main" {
  name       = "wealthgenie-${var.environment}-docdb-subnet-group"
  subnet_ids = var.subnet_ids

  tags = {
    Name        = "wealthgenie-${var.environment}-docdb-subnets"
    Environment = var.environment
  }
}

resource "aws_security_group" "docdb" {
  name        = "wealthgenie-${var.environment}-docdb-sg"
  description = "Control traffic to managed DocumentDB / MongoDB cluster"
  vpc_id      = var.vpc_id

  dynamic "ingress" {
    for_each = var.app_security_group_id == null ? [] : [var.app_security_group_id]
    content {
      description     = "MongoDB protocol from the explicitly supplied application workload"
      from_port       = 27017
      to_port         = 27017
      protocol        = "tcp"
      security_groups = [ingress.value]
    }
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name        = "wealthgenie-${var.environment}-docdb-sg"
    Environment = var.environment
  }
}

resource "aws_docdb_cluster" "docdb" {
  cluster_identifier      = "wealthgenie-${var.environment}-docdb"
  engine                  = "docdb"
  engine_version          = var.documentdb_engine_version
  master_username         = var.master_username
  master_password         = random_password.master_password.result
  backup_retention_period = 14
  preferred_backup_window = "02:00-03:00"
  deletion_protection     = var.documentdb_deletion_protection
  skip_final_snapshot     = var.documentdb_skip_final_snapshot
  final_snapshot_identifier = local.final_snapshot_identifier
  db_subnet_group_name    = aws_docdb_subnet_group.main.name
  vpc_security_group_ids  = [aws_security_group.docdb.id]
  storage_encrypted       = true
  kms_key_id              = var.kms_key_arn

  tags = {
    Name        = "wealthgenie-${var.environment}-docdb"
    Environment = var.environment
  }
}

resource "aws_docdb_cluster_instance" "instances" {
  count              = var.db_cluster_size
  identifier         = "wealthgenie-${var.environment}-docdb-${count.index + 1}"
  cluster_identifier = aws_docdb_cluster.docdb.id
  instance_class     = var.db_instance_class

  tags = {
    Name        = "wealthgenie-${var.environment}-docdb-instance-${count.index + 1}"
    Environment = var.environment
  }
}
