#!/usr/bin/env node
/**
 * Regenerate src/server/embedded-data.mjs — the shipped data files embedded
 * as text for serverless deployments (Vercel), where the repository layout
 * is not on disk next to the function bundle.
 *
 * The file list mirrors what the endpoint module resolves against the repo
 * root at runtime: CCTV registries, compiled datasets, and the CelesTrak
 * TLE seeds.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const files = [
  'config/cctv_sources.austin.json',
  'config/cctv_catalogs.json',
  'config/cctv_sources.miami.json',
  'config/cctv_sources.shinjuku.json',
  'data/airports.json',
  'data/safety.json',
  'data/shootings.json',
  'data/tle/galileo.txt',
  'data/tle/geo.txt',
  'data/tle/glo-ops.txt',
  'data/tle/gps-ops.txt',
  'data/tle/stations.txt',
  'data/tle/visual.txt',
];

const lines = [
  '/**',
  ' * Shipped data files, embedded as text for serverless deployments where the',
  ' * repository layout is not on disk (Vercel function bundles). The runtime',
  ' * patch (gev-runtime-patch.mjs) seeds these under the writable temp dir',
  ' * before the endpoint module resolves its data paths.',
  ' *',
  ' * REGENERATE with: node scripts/embed-server-data.mjs',
  ' * @module embedded-data',
  ' */',
  'export const EMBEDDED_FILES = new Map([',
];

let total = 0;
for (const f of files) {
  const raw = fs.readFileSync(path.join(root, f), 'utf8');
  total += raw.length;
  lines.push(`  [${JSON.stringify(f)}, ${JSON.stringify(raw)}],`);
}
lines.push(']);');
fs.writeFileSync(path.join(root, 'src/server/embedded-data.mjs'), lines.join('\n') + '\n');
console.log(`embedded ${files.length} files, ${total} chars of data`);
