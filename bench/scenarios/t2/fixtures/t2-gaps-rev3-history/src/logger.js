export function audit(event, fields = {}) {
  return { event, at: new Date().toISOString(), ...fields };
}

export function quiet() { return undefined; }
