// SPDX-License-Identifier: Apache-2.0
'use strict';

// The standard checks of a T2 task. They look at what the hidden findings test cannot: that the output exists, that
// its findings block has the asked shape, that every location names a real place in the project, and that the review
// left the work under review alone. The `cmd` scripts are inline because a `cmd` check runs in the agent's workspace,
// where no bench file is present. Each script is wrapped in single quotes for `sh -c`, so it uses only double quotes.

// Reads the first fenced json (or untagged) block of REVIEW.md that parses to a list of objects into L; exits 1 if none.
const BLOCK = 'const fs=require("fs");const t=fs.readFileSync("REVIEW.md","utf8");let L=null;'
  + 'for(const m of t.matchAll(/^\\x60\\x60\\x60([a-z]*)[ \\t]*\\n([\\s\\S]*?)^\\x60\\x60\\x60[ \\t]*$/gim)){'
  + 'if(m[1]&&m[1].toLowerCase()!=="json")continue;let d;try{d=JSON.parse(m[2])}catch{continue}'
  + 'const l=Array.isArray(d)?d:Array.isArray(d&&d.findings)?d.findings:null;'
  + 'if(l&&l.every(x=>x&&typeof x==="object"&&!Array.isArray(x))){L=l;break}}if(!L||!L.length)process.exit(1);';

const node = (js) => `node -e '${js}'`;

// Every item has a location, a severity from the scale, and an issue or fix text.
const SHAPE = node(`${BLOCK}const S=["critical","high","medium","low","nit"];`
  + 'process.exit(L.every(x=>x.location&&S.includes(String(x.severity).toLowerCase())&&(x.issue||x.fix||x.text))?0:1)');

// Code: every path:line in a location is an existing file with at least that many lines, and there is at least one.
const CODE_LOCATIONS = node(`${BLOCK}let n=0;for(const x of L)for(const m of String(x.location).matchAll(/([A-Za-z0-9_.\\/-]+\\.[A-Za-z0-9]+):(\\d+)/g)){`
  + 'n++;let c;try{c=fs.readFileSync(m[1],"utf8").split("\\n").length}catch{process.exit(1)}if(+m[2]<1||+m[2]>c)process.exit(1)}'
  + 'process.exit(n?0:1)');

// Design: every location names a section number that is a heading number of the document.
const designLocations = (doc) => node(`${BLOCK}const H=new Set();for(const l of fs.readFileSync("${doc}","utf8").split("\\n")){`
  + 'const m=l.match(/^#+\\s*(?:section\\s*)?(\\d+(?:\\.\\d+)*)/i);if(m)H.add(m[1])}'
  + 'process.exit(L.every(x=>{const m=String(x.location).match(/\\d+(?:\\.\\d+)*/);return m&&H.has(m[0])})?0:1)');

function reviewChecks({ kind, doc, unchangedPath, testsMin }) {
  return [
    { type: 'tests', cmd: 'node --test --test-timeout=15000 hidden/findings.test.cjs', min: testsMin, weight: 1, kind: 'substance' },
    { type: 'file_exists', path: 'REVIEW.md', weight: 1, kind: 'substance' },
    { type: 'cmd', cmd: SHAPE, expectExit: 0, weight: 1, kind: 'format' },
    { type: 'cmd', cmd: kind === 'design' ? designLocations(doc) : CODE_LOCATIONS, expectExit: 0, weight: 2, kind: 'substance' },
    { type: 'fixture_unchanged', path: unchangedPath, weight: 1, kind: 'substance' },
  ];
}

// A twin's prompt forbids nothing, so it has no fixture_unchanged check.
function twinChecks({ output, testsMin }) {
  return [
    { type: 'tests', cmd: 'node --test --test-timeout=15000 hidden/twin.test.cjs', min: testsMin, weight: 1, kind: 'substance' },
    { type: 'file_exists', path: output, weight: 1, kind: 'substance' },
  ];
}

module.exports = { reviewChecks, twinChecks };
