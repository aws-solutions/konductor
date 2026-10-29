'use strict';

const left = (text, width) => String(text).padStart(width);
const right = (text, width) => String(text).padEnd(width);

module.exports = { left, right };
