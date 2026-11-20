# Customer API

The repository is the stable boundary used by the HTTP adapter. A customer has an integer `id`, `name`, `email`, and optional `address`. Address values use `line1`, `line2`, `city`, `region`, `postalCode`, and `country`.

`src/http.js` accepts `GET /customers`, `GET /customers/:id`, and `POST /customers`. The adapter returns JSON and uses 404 when a requested customer does not exist.
