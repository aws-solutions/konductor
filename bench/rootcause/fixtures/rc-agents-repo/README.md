# tinydates

Small helpers to parse and format ISO dates without dependencies.

## Develop

Install with `yarn install`, run the tests with `yarn test` and build the bundle with `yarn build`.

## Use

```js
const { parse, format } = require('tinydates');
format(parse('2025-03-14'));
```
