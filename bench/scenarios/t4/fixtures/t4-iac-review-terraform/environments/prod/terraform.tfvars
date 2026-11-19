environment = "prod"
region      = "us-east-1"
account_id  = "111122223333"

db_instance_class = "db.t3.medium"
ecs_desired_count = 2

alarm_actions = [
  "arn:aws:sns:us-east-1:111122223333:platform-alerts"
]

tags = {
  Environment = "production"
  CostCenter  = "engineering"
  Owner       = "platform-team"
}