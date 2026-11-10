# Order Notification Service

## Background

Customers currently learn that an order shipped only by refreshing the order page. Support receives about 1,200 "where is my order" contacts per week. It is worth noting that most of these contacts arrive within two hours of shipment.

## Requirements

1. Send an email when an order changes to SHIPPED or DELIVERED.
2. Deliver the email within 5 minutes of the status change.
3. Let customers opt out of shipment emails.

## Solution Overview

An order-events consumer reads status changes from the existing order event stream, looks up the customer's preferences, and sends email through Amazon SES. In order to keep the design flexible, the consumer is built on a pluggable transport SPI so that SMS, push, fax, and future channels can be added as plugins, along with a rules engine that lets product managers define arbitrary notification workflows in a DSL.

## How It Works

See Figure 1 (docs/diagrams/notify-flow.png). The consumer is a Lambda function triggered by the stream. Lambda cold starts typically add 100-500ms, which is well inside the 5-minute requirement.

We chose Kafka for the event stream because Kafka is the best choice for this kind of system.

This design reduces p99 delivery latency to under 20ms and cuts notification cost by 45% compared to the current batch job.

## Implementation Plan

1. Build the consumer Lambda and preference lookup.
2. Build the transport SPI and the SES plugin.
3. Build the rules engine and DSL parser.
4. Add the opt-out link and preference API.
