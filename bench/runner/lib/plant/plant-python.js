// SPDX-License-Identifier: Apache-2.0
'use strict';

// The release's wheel pins against the plant Python (DEBT D-179). A release manifest's `wheels` ({name: version or "*"})
// names the wheels its poses were made with; before the first trial the plant Python must hold those versions. That the
// Python imports the gateway's modules at all is python-pin.js checkGatewayModules (D-180).

const { spawnSync } = require('node:child_process');
const { ReleaseRefused } = require('./manifest.js');

// One Python run: the installed version of each named wheel, null when absent.
const PROBE = [
  'import importlib.metadata as m, json, sys',
  'def ver(n):',
  '    try: return m.version(n)',
  '    except Exception: return None',
  'print(json.dumps({n: ver(n) for n in json.loads(sys.argv[1])}))',
].join('\n');

/**
 * Throws ReleaseRefused unless `python` holds every wheel `release.manifest.wheels` pins ("*": any version). Runs
 * nothing when the manifest pins none. `run` is the spawnSync seam; the probe inherits `env`.
 */
function checkReleaseWheels({ python, release, env = process.env, run = spawnSync }) {
  const wheels = release.manifest.wheels ?? {};
  if (!Object.keys(wheels).length) return;
  const r = run(python, ['-c', PROBE, JSON.stringify(Object.keys(wheels))], { encoding: 'utf8', env, timeout: 60000 });
  let versions;
  try { versions = JSON.parse(String(r.stdout).trim().split('\n').at(-1)); } catch { versions = null; }
  if (r.error || r.status !== 0 || !versions) throw new ReleaseRefused(`the plant Python ${python} did not run the wheel check (${r.error?.message ?? `exit ${r.status}`}); pass --plant-python with the release's wheels`);
  const problems = Object.entries(wheels).flatMap(([name, want]) => {
    const got = versions[name];
    if (got === null || got === undefined) return [`${name} is not installed (the release pins ${want})`];
    return want !== '*' && got !== want ? [`it has ${name} ${got}, but the release pins ${want}`] : [];
  });
  if (problems.length) throw new ReleaseRefused(`the plant Python ${python}: ${problems.join('; ')}. A run on other wheels can make other poses (D-179)`);
}

module.exports = { checkReleaseWheels };
