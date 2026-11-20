let serial = 0;
export function makeId(prefix = 'job') { serial += 1; return `${prefix}-${serial}`; }
