# Glossary: Notification Fanout Service

## A
**APNs (Apple Push Notification Service)**
Apple's service for delivering push notifications to iOS, iPadOS, macOS, and watchOS devices.

**At-least-once delivery**
A messaging guarantee where each message is delivered one or more times. Systems must handle duplicates.

## C
**Consumer group**
A set of Kafka consumers that work together to consume messages from topics. Each partition is consumed by exactly one consumer in the group.

**Circuit breaker**
A design pattern that detects failures and prevents cascading failures by stopping requests to a failing service.

## D
**Deduplication**
The process of identifying and removing duplicate messages to ensure exactly-once semantics.

**Dead-letter queue (DLQ)**
A queue where messages that cannot be processed are stored for later analysis or reprocessing.

## E
**Exactly-once delivery**
A messaging guarantee where each message is delivered exactly once, with no duplicates.

**Exponential backoff**
A retry strategy where the wait time between retries increases exponentially (e.g., 1s, 2s, 4s, 8s).

## F
**FCM (Firebase Cloud Messaging)**
Google's cross-platform messaging solution for delivering messages to Android, iOS, and web applications.

**Fanout**
The process of distributing a single message to multiple consumers or endpoints.

## I
**Idempotency key**
A unique identifier that allows operations to be repeated safely without unintended side effects.

**In-app message**
A notification displayed within the application interface while the user is actively using the app.

## K
**Kafka**
Apache Kafka, a distributed event streaming platform used for building real-time data pipelines and streaming applications.

## P
**Partition**
A division of a Kafka topic that allows for parallel processing and scalability.

**Push notification**
A message sent from a server to a mobile device, displayed even when the app is not active.

## Q
**Quiet hours**
Time periods during which non-urgent notifications should not be sent to respect user preferences.

## R
**Retention period**
The length of time data is stored before being deleted or archived.

**Replication factor**
The number of copies of data maintained in a distributed system for fault tolerance.

## S
**SendGrid**
A cloud-based email delivery platform used for transactional and marketing emails.

**SES (Simple Email Service)**
Amazon Web Services' email sending service.

**SLO (Service Level Objective)**
A target value for a service level measured over a period of time.

## T
**Topic**
A category or feed name to which messages are published in Kafka.

## V
**Vendor API**
Third-party service API used for notification delivery (e.g., APNs, FCM, SendGrid).

## Z
**Zero-downtime deployment**
A deployment strategy that allows updates to be applied without interrupting service availability.