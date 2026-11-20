const states = new Map([['catalogue', 'ready'], ['member-portal', 'ready'], ['service-desk', 'quiet']]);

function status(name) {
  return states.get(name) || 'unknown';
}

module.exports = { status };
