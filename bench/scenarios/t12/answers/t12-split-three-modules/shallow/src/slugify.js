'use strict';

// See docs/specs/slugify.md. Shallow fake: lower case and dashes for spaces, none of the other rules.
function slugify(text) {
  return String(text).toLowerCase().replace(/\s+/g, '-');
}

module.exports = { slugify };
