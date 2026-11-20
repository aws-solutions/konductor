const pluginNames = new Set(['compact', 'verbose']);

export async function loadPlugin(name) {
  if (!pluginNames.has(name)) throw new Error(`Unknown plugin: ${name}`);
  const module = await import(new URL(`../plugins/${name}.js`, import.meta.url));
  return module.default;
}
