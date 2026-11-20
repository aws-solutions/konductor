import { format } from './lib/format.js';
import { loadPlugin } from './lib/load-plugin.js';
import { readBanner } from './lib/read-banner.js';
import { manifest } from './lib/manifest.js';
import { cycleValue } from './lib/cycle-value.js';

function lantern(value, options) {
  return format(value, options);
}

lantern.format = format;
lantern.loadPlugin = loadPlugin;
lantern.banner = readBanner();
lantern.manifest = manifest;
lantern.cycleValue = cycleValue;

export default lantern;
export { format, loadPlugin, readBanner };
export const banner = lantern.banner;
export { manifest, cycleValue };
