# DocShare change: public upload-back

Recipients can now upload a signed copy back. New route `POST /s/{token}/upload` (unauthenticated, same token as the share link) returns a presigned S3 PUT URL for `returns/{token}/{filename}` in `docshare-docs`. Max size is not enforced yet. The `filename` comes from the request body.
