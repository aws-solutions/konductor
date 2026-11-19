environment = "staging"
region      = "us-east-1"
account_id  = "111122223333"

db_instance_class = "db.t3.small"
ecs_desired_count = 1

tags = {
  Environment = "staging"
  CostCenter  = "engineering"
  Owner       = "platform-team"
}