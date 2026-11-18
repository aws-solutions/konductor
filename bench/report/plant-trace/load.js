// SPDX-License-Identifier: Apache-2.0
'use strict';

// Reads the files of one plant trial (the dir `bench run` wrote for one task, arm and replicate). Files only, no network.

const fs = require('node:fs');
const path = require('node:path');
const { parseStream } = require('../../runner/lib/stream.js');
const { runtimeOf, descriptorOf } = require('../../runner/lib/harness/runtime.js');

class PlantTraceError extends Error {}

const FILES = { result: 'result.json', stream: 'stream.jsonl', gateway: path.join('plant', 'gateway.jsonl'), world: path.join('plant', 'world.jsonl') };

/** The text of file `rel` in trial dir `dir`. Throws PlantTraceError when it cannot be read, so the dir is not a trial dir. */
function readRequired(dir, rel) {
  try {
    return fs.readFileSync(path.join(dir, rel), 'utf8');
  } catch {
    throw new PlantTraceError(`${dir} is not a plant trial dir: cannot read ${rel}`);
  }
}

/**
 * The files of the trial in `dir`: `{dir, result, gateway, world, events, streamFormat, badLines}`.
 * `result` is the parsed result.json; `gateway` and `world` are the parsed lines of plant/gateway.jsonl (the log the agent
 * cannot touch) and plant/world.jsonl (the simulator's state after each call); `events` are the agent stream's events.
 * `streamFormat` is the stream format of the run's harness (a harness descriptor's `streamFormat`), and `badLines` counts
 * log lines that were not JSON and were skipped. Throws PlantTraceError when a file is missing or result.json is not JSON.
 */
function readTrial(dir) {
  let result;
  try {
    result = JSON.parse(readRequired(dir, FILES.result));
  } catch (e) {
    if (e instanceof PlantTraceError) throw e;
    throw new PlantTraceError(`${dir}/${FILES.result} is not valid JSON`);
  }
  const gateway = parseStream(readRequired(dir, FILES.gateway));
  const world = parseStream(readRequired(dir, FILES.world));
  const stream = parseStream(readRequired(dir, FILES.stream));
  return {
    dir, result, gateway: gateway.events, world: world.events, events: stream.events,
    streamFormat: descriptorOf(runtimeOf(result)).streamFormat,
    badLines: gateway.badLines + world.badLines + stream.badLines,
  };
}

module.exports = { readTrial, PlantTraceError };
