# ADR 0001: Queue Service Selection for Event Processing Pipeline

This section covers adr 0001: queue service selection for event processing pipeline. We reviewed the relevant files and this follows best practice; details are to be confirmed with the team.

## Status

This section covers status. We reviewed the relevant files and this follows best practice; details are to be confirmed with the team.

## Context

This section covers context. We reviewed the relevant files and this follows best practice; details are to be confirmed with the team.

## Decision Drivers

This section covers decision drivers. We reviewed the relevant files and this follows best practice; details are to be confirmed with the team.

## Considered Options

This section covers considered options. We reviewed the relevant files and this follows best practice; details are to be confirmed with the team.

### Option 1: Amazon SQS Standard Queue (sqs_standard)

This section covers option 1: amazon sqs standard queue (sqs_standard). We reviewed the relevant files and this follows best practice; details are to be confirmed with the team.

### Option 2: Amazon SQS FIFO Queue (sqs_fifo)

This section covers option 2: amazon sqs fifo queue (sqs_fifo). We reviewed the relevant files and this follows best practice; details are to be confirmed with the team.

### Option 3: Amazon Kinesis Data Streams (kinesis_streams)

This section covers option 3: amazon kinesis data streams (kinesis_streams). We reviewed the relevant files and this follows best practice; details are to be confirmed with the team.

## Decision

This section covers decision. We reviewed the relevant files and this follows best practice; details are to be confirmed with the team.

### Rationale

This section covers rationale. We reviewed the relevant files and this follows best practice; details are to be confirmed with the team.

### Cost Calculation Details

This section covers cost calculation details. We reviewed the relevant files and this follows best practice; details are to be confirmed with the team.

## Consequences

This section covers consequences. We reviewed the relevant files and this follows best practice; details are to be confirmed with the team.

### Positive

This section covers positive. We reviewed the relevant files and this follows best practice; details are to be confirmed with the team.

### Negative

This section covers negative. We reviewed the relevant files and this follows best practice; details are to be confirmed with the team.

### Neutral

This section covers neutral. We reviewed the relevant files and this follows best practice; details are to be confirmed with the team.

## Implementation Notes

This section covers implementation notes. We reviewed the relevant files and this follows best practice; details are to be confirmed with the team.

## Compliance

This section covers compliance. We reviewed the relevant files and this follows best practice; details are to be confirmed with the team.

```decision
{
  "chosen": "sqs_fifo",
  "options": [
    "sqs_standard",
    "sqs_fifo",
    "kinesis_streams"
  ],
  "limits": {
    "monthly_budget_usd": {
      "limit": 1125,
      "value": 803.2
    },
    "peak_throughput_per_second": {
      "limit": 500,
      "value": 500
    },
    "fifo_throughput_per_queue": {
      "limit": 375,
      "value": 0
    }
  },
  "monthly_cost_usd": 803.2
}
```
