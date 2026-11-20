export function reconcileNames(names: string[]) {
  return names.filter(Boolean).map((name) => name.trim()).filter((name, index, all) => all.indexOf(name) === index);
}
