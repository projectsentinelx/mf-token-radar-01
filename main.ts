// The token radar's entry point (Node 22, standard library only).
//
// Reads the sealed snapshot at /input/snapshot.json (or --input <file|dir>), scores every launch
// subject with lib/model.ts, writes the ranked board to /output/board.json, writes the dashboard's
// dataset to /output/data.js, copies dashboard/ and screenshots/ to /output, and writes
// /output/dossier.json with the kit's buildDossier, which the scorer rebuilds byte for byte.
//
// Outside the grader's container MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../kit/input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps (reference/gate.json): the text cap shapes the dossier, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const DASHBOARD_CAPS = { max_files: 400, max_bytes: 4_194_304 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory>\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy a directory's files into `to`, keeping its subdirectories and skipping dot names. */
function copyTree(from: string, to: string): number {
  if (!existsSync(from)) return 0;
  mkdirSync(to, { recursive: true });
  let copied = 0;
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    const stat = statSync(path);
    if (stat.isDirectory()) copied += copyTree(path, join(to, name));
    else if (stat.isFile()) {
      copyFileSync(path, join(to, name));
      copied += 1;
    }
  }
  return copied;
}

const dashboardFiles = copyTree(join(here, 'dashboard'), join(out, 'dashboard'));
const shotsDir = join(out, 'screenshots');
const shots = copyTree(join(here, 'screenshots'), shotsDir);
for (const name of existsSync(shotsDir) ? readdirSync(shotsDir) : []) {
  if (name.startsWith('.')) continue;
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

if (shots < 3) {
  process.stderr.write(`token radar: ${shots} screenshots in /output/screenshots: hand in 3, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
const dossier = buildDossier(out, {
  text_max_bytes: TEXT_MAX_BYTES,
  screenshots: SCREENSHOT_CAPS,
  dashboard: DASHBOARD_CAPS,
});
writeFileSync(join(out, 'dossier.json'), dossier);

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ` +
    `${board.length} launch subjects ranked (${radar.early_size} below the floor), ${radar.live_size} live peers measured\n` +
    `token radar: wrote board.json, data.js, dashboard/ (${dashboardFiles} files), screenshots/ (${shots})` +
    `${shots >= 3 ? ' and dossier.json' : ''}\n`,
);
