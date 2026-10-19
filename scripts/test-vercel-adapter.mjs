/**
 * Local integration test for the Vercel adapter: imports the same entry
 * module Vercel bundles (api/[...gev].mjs), serves it over real HTTP, and
 * checks the plumbing for a representative spread of endpoints. Upstream
 * network calls are expected to fail in the sandbox — the point is that
 * each endpoint responds with its proper shape (data, cached/stale data,
 * or a clean error JSON) instead of crashing.
 *
 * Run: node scripts/test-vercel-adapter.mjs
 */
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || 'test-key-not-used-offline';

const { default: handler } = await import(new URL('../api/[...gev].mjs', import.meta.url));

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) return void handler(req, res);
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/plain');
  res.end('static-ok');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

let failures = 0;
async function check(name, url, opts = {}, expect) {
  try {
    const resp = await fetch(base + url, { ...opts, signal: AbortSignal.timeout(25000) });
    const text = await resp.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    const ok = expect({ status: resp.status, body: text, json });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name} → ${resp.status} ${text.slice(0, 110).replace(/\n/g, ' ')}`);
    if (!ok) failures++;
  } catch (error) {
    failures++;
    console.log(`FAIL ${name} → threw: ${error?.message || error}`);
  }
}

await check('airports dataset (embedded data)', '/api/airports?query=HKG', {}, (r) =>
  r.status === 200 && r.json && Array.isArray(r.json.airports) && r.json.airports.length > 0
  && r.json.airports.some((a) => String(a.name || a.iata || '').includes('Hong Kong')));

await check('shootings dataset (embedded data)', '/api/shootings', {}, (r) =>
  r.status === 200 && r.json && Array.isArray(r.json.incidents) && r.json.incidents.length > 0);

await check('cctv sources (embedded registry)', '/api/cctv/sources', {}, (r) =>
  r.status === 200 && r.json && Array.isArray(r.json.sources));

await check('celestrak groups (seed TLE fallback)', '/api/celestrak/stations', {}, (r) =>
  r.status === 200 && (r.body.includes('1 -') || r.body.length > 200));

await check('overpass POST body bridge', '/api/overpass', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ query: '[out:json];node(56);out;' }),
}, (r) => r.status === 400 && r.json && /data query/i.test(r.json.error || ''));

await check('overpass GET rejected', '/api/overpass', {}, (r) =>
  r.status === 405 && r.json && /not allowed/i.test(r.json.error || ''));

await check('google text-search (key set, upstream blocked)', '/api/google/text-search?query=hong+kong', {}, (r) =>
  r.status < 500 && r.json && Array.isArray(r.json.places));

await check('opensky (upstream blocked → clean error)', '/api/opensky', {}, (r) =>
  r.status >= 400 && r.status < 600 && r.json && typeof r.json.error === 'string');

await check('route prefix boundary (opensky-track not opensky)', '/api/opensky-track?icao24=abc123', {}, (r) =>
  r.status >= 400 && r.status < 600);

await check('unknown api path → 404 JSON', '/api/definitely-not-real', {}, (r) =>
  r.status === 404 && r.json && r.json.error === 'Not found');

await check('static path bypasses api', '/index.html', {}, (r) => r.status === 200 && r.body === 'static-ok');

// cwd remap: process.cwd() must be the writable temp mirror now
const cwd = process.cwd();
console.log(`${cwd === path.join(os.tmpdir(), 'gev') ? 'PASS' : 'FAIL'} process.cwd() remapped → ${cwd}`);
if (cwd !== path.join(os.tmpdir(), 'gev')) failures++;
// embedded mirror seeded?
console.log(`${fs.existsSync(path.join(os.tmpdir(), 'gev', 'data', 'airports.json')) ? 'PASS' : 'FAIL'} embedded data seeded into temp mirror`);
if (!fs.existsSync(path.join(os.tmpdir(), 'gev', 'data', 'airports.json'))) failures++;

server.close();
console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
