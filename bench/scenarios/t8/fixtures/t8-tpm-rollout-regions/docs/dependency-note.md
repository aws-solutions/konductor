# Cross-team dependency note

Edge API must publish and verify a region route before Wallet Client enables its regional wallet flag. The client canary must never be the first production action in a region.

Data Platform's schema expansion is backward compatible, but the writer release belongs after the expansion has been observed healthy. Partner Integrations owns the bank handshake and supplies the certification record before Solmere traffic is enabled.
