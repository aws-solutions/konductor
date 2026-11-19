# Internal certificate rotation

The gateway presents a region-specific client certificate to the auth service. Rotation is expected at least
14 days before the not-after time. The certificate inventory is the source for serial numbers and expiration
times; the service logs show whether a presented certificate was accepted.

After a replacement, confirm a successful handshake in each region before restoring normal routing.
