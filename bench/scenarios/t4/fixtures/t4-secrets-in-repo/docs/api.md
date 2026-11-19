# Internal API

`GET /health` returns a JSON object with `status` and `queueDepth`.

Notification jobs contain `channel`, `to`, and `body`. SMS jobs may include a subject for clients that display it in a preview. Phone numbers are normalized before dispatch.
