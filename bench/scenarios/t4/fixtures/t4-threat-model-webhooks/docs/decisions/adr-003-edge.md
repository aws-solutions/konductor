# ADR-003: Terminate public TLS at the edge

## Decision

EdgeGateway terminates client TLS and opens a new TLS connection to the relay service over the private network.

## Context

The edge proxy already provides certificate lifecycle management and common access logs. Re-encryption on the service hop keeps the private segment protected in transit.

## Consequence

The relay trusts the edge's forwarded request metadata only on the private listener. Direct public access to a service instance is not part of the deployment topology.
