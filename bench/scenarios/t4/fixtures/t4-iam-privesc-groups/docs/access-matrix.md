# Access matrix

| Group | Work it performs | Main data or service |
| --- | --- | --- |
| Developers | Build, update, and inspect team functions; rotate their own keys | Lambda and application logs |
| Analysts | Run read-only queries and inspect data catalog entries | The analytics lake |
| On-call | Restart listed services and inspect operational measurements | ECS and CloudWatch |

The account bootstrap attaches `iam/permissions-boundary.json` to each group role. A caller's username is available to the policy when a task is limited to that caller's own IAM user.
