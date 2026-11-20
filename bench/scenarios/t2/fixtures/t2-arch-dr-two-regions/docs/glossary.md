# Glossary of Terms

## Architecture Terms

**Active-Active**: A deployment pattern where multiple instances of a service handle live traffic simultaneously, improving availability and reducing latency.

**Region**: A geographical area containing multiple Availability Zones (AZs). For this project: us-east-1 (N. Virginia) and us-west-2 (Oregon).

**Availability Zone (AZ)**: One or more discrete data centers within a region, with redundant power, networking, and connectivity.

**Replication Lag**: The delay between a write operation in the source database and its application in the replica database, measured in milliseconds.

**Conflict Resolution**: The process of determining which version of data to keep when concurrent updates occur in different regions.

## Database Terms

**RPO (Recovery Point Objective)**: The maximum acceptable amount of data loss measured in time. Example: "RPO of 60 seconds" means no more than 60 seconds of data should be lost.

**RTO (Recovery Time Objective)**: The maximum acceptable delay between interruption of service and restoration of service.

**Last-Write-Wins (LWW)**: A conflict resolution strategy where the most recent write (based on timestamp) takes precedence over earlier writes.

**Logical Replication**: A method of replicating data objects and their changes based on their replication identity (usually a primary key).

**Asynchronous Replication**: A replication method where the primary database doesn't wait for the replica to confirm receipt of data before committing transactions.

## Networking Terms

**DNS TTL (Time to Live)**: The duration that DNS records are cached by resolvers and clients, measured in seconds.

**Latency-Based Routing**: A DNS routing policy that directs users to the AWS region that provides the lowest network latency.

**Health Check**: A periodic test to verify that an endpoint is reachable and responding correctly.

**Failover**: The process of switching to a redundant or standby system when the primary system fails.

**Failback**: The process of returning traffic to the original system after a failover event.

## Business Terms

**Double Booking**: The undesirable situation where the same seat is sold to multiple customers.

**Seat Inventory**: The count of available seats for a given event or flight.

**Transaction Volume**: The number of booking transactions processed per unit of time.

**Revenue Impact**: The financial effect of service disruptions or errors.

**Customer Satisfaction (CSAT)**: A measure of how products or services meet or surpass customer expectations.

## Technical Terms

**P95, P99**: Percentile metrics. P95 means 95% of observations fall below this value.

**SLO (Service Level Objective)**: A target level for the reliability of a service.

**SLA (Service Level Agreement)**: A contract that defines the level of service expected from a service provider.

**Circuit Breaker**: A design pattern that prevents an application from repeatedly trying to execute an operation that's likely to fail.

**Chaos Engineering**: The discipline of experimenting on a system in order to build confidence in the system's capability to withstand turbulent conditions.

## AWS Services

**EC2 (Elastic Compute Cloud)**: Virtual servers in the cloud.

**RDS (Relational Database Service)**: Managed relational database service.

**ELB/ALB (Elastic Load Balancer/Application Load Balancer)**: Distributes incoming traffic across multiple targets.

**Route 53**: Scalable DNS and domain name registration.

**CloudWatch**: Monitoring and observability service.

**DMS (Database Migration Service)**: Service for migrating databases to AWS.

## Acronyms

- **API**: Application Programming Interface
- **GB**: Gigabyte
- **HTTP**: Hypertext Transfer Protocol
- **IP**: Internet Protocol
- **PCI DSS**: Payment Card Industry Data Security Standard
- **PII**: Personally Identifiable Information
- **RPM**: Requests Per Minute
- **S3**: Simple Storage Service
- **TTL**: Time to Live
- **UTC**: Coordinated Universal Time

---

*Version: 1.0*
*Last Updated: 2024-03-14*