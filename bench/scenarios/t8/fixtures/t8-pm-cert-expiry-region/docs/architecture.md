# Atlas Login request path

Browser -> global load balancer -> regional edge -> internal gateway -> regional auth service.

The two regional auth pools are independent. The gateway-to-auth hop uses mutual TLS, while the edge-to-gateway
hop uses ordinary service authentication. A regional edge can temporarily send login traffic to the healthy
regional pool during an incident.
