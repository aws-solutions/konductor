'use strict';

function summarize(results) {
  const values = Array.isArray(results) ? results : [];
  return {
    total: values.length,
    healthy: values.filter((item) => item && item.ok === true).length,
    degraded: values.filter((item) => item && item.ok === false).length
  };
}

module.exports = { summarize };
