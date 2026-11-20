let _partner = null;

export function value() {
  return 'cycle-a';
}

export function partner() {
  return _partner;
}

export function setPartner(p) {
  _partner = p;
}
