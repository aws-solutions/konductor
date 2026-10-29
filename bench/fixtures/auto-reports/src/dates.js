'use strict';

// "2025-03-06T10:00:00Z" -> "2025-03". Timestamps in the exports are UTC.
function monthOf(iso) {
  return String(iso).slice(0, 7);
}

module.exports = { monthOf };
