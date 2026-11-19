'use strict';

function withCallback(promise, callback) {
  if (typeof callback !== 'function') return promise;
  promise.then(
    (value) => { try { callback(null, value); } catch (_) {} },
    (error) => { try { callback(error); } catch (_) {} }
  );
  // A callback consumer may intentionally ignore the returned promise.
  promise.catch(() => {});
  return promise;
}

module.exports = { withCallback };
