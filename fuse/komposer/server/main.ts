// SPDX-License-Identifier: Apache-2.0
// Start Komposer on one project:
//
//   bun run start -- [<project directory>] [--port <n>]
//
// The project is the git repository at or above the directory given (the
// current one by default). The command prints the URL to open, which carries
// the session's token.

import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { findRepoRoot } from "../../flow/src/project.ts";
import { startServer } from "./app.ts";

const DEFAULT_PORT = 4807;

function parseArgs(argv: string[]): { dir: string; port: number } {
  let dir = process.cwd();
  let port = DEFAULT_PORT;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--port") {
      port = Number(argv[++i]);
      if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("--port needs a port number");
    } else if (arg.startsWith("-")) {
      throw new Error(`unknown option ${arg}; usage: bun run start -- [<project directory>] [--port <n>]`);
    } else {
      dir = arg;
    }
  }
  return { dir, port };
}

try {
  const { dir, port } = parseArgs(process.argv.slice(2));
  const root = findRepoRoot(dir);
  const token = randomBytes(24).toString("base64url");
  const server = startServer({ root, port, token, appDir: resolve(import.meta.dir, "..", "dist") });
  console.log(`Komposer for ${root}`);
  console.log(`open ${server.url}/#token=${token}`);
  console.log(`with \`bun run dev\`, open http://127.0.0.1:5173/#token=${token}`);
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
