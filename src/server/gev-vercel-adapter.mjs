/**
 * Vercel (and any Node HTTP server) adapter for the God's Eye View API.
 *
 * The endpoint middlewares are standard Connect handlers registered through
 * the Vite plugin `configureServer` hook. This module replays that
 * registration against a plain recorder and dispatches incoming requests
 * through the same chain, so a deployed build serves the exact same
 * endpoints as `npm run dev`.
 *
 * Request bridge: Vercel's Node runtime may hand the function a request
 * whose body stream is already consumed (the parsed body is available as
 * `req.body`), while the middlewares read raw bytes (req.on('data') /
 * for-await). The bridge drains whatever is available once, falls back to
 * the platform-parsed body, and hands the middleware a replay stream with
 * the original headers/method/socket attached.
 *
 * @module gev-vercel-adapter
 */

import { Readable } from 'node:stream';
import { createGevServerPlugins } from './gev-endpoints.mjs';

/** @type {Promise<Array<{prefix: string, fn: Function}>|null>} */
let handlersPromise = null;

/**
 * Build the middleware chain once per instance by mounting every plugin's
 * `configureServer` on a recorder (Vite's dev-server object shape, minus
 * everything the middlewares don't touch).
 *
 * @returns {Promise<Array<{prefix: string, fn: Function}>>}
 */
function buildHandlers() {
  if (!handlersPromise) {
    handlersPromise = Promise.resolve().then(() => {
      const handlers = [];
      const fakeServer = {
        middlewares: {
          use: (prefix, fn) => {
            handlers.push({ prefix, fn });
          },
        },
        httpServer: { on: () => {} },
      };
      for (const plugin of createGevServerPlugins()) {
        if (plugin && typeof plugin.configureServer === 'function') {
          plugin.configureServer(fakeServer);
        }
      }
      return handlers;
    });
  }
  return handlersPromise;
}

/**
 * Serialize the platform-parsed body (Vercel exposes req.body as JSON
 * object, string, or Buffer) into the raw bytes the middlewares expect.
 *
 * @param {object} req
 * @returns {Buffer}
 */
function rawBodyFromParsed(req) {
  const body = req?.body;
  if (Buffer.isBuffer(body)) return body;
  if (typeof body === 'string' && body.length) return Buffer.from(body, 'utf8');
  if (body && typeof body === 'object') {
    try {
      return Buffer.from(JSON.stringify(body), 'utf8');
    } catch {
      return Buffer.alloc(0);
    }
  }
  return Buffer.alloc(0);
}

/**
 * Consume the request body (whichever side the platform left it on) and
 * return a fresh readable that replays it exactly once, plus the original
 * request metadata the middlewares rely on.
 *
 * @param {object} req
 * @returns {Promise<import('node:stream').Readable>}
 */
async function bridgeRequest(req) {
  let raw = Buffer.alloc(0);
  try {
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(Buffer.from(chunk));
    }
    raw = Buffer.concat(chunks);
  } catch {
    /* stream already consumed or unavailable — fall through to req.body */
  }
  if (!raw.length) raw = rawBodyFromParsed(req);

  const replay = Readable.from(raw.length ? [raw] : []);
  replay.headers = req.headers;
  replay.method = req.method;
  replay.httpVersion = req.httpVersion;
  replay.httpVersionMajor = req.httpVersionMajor;
  replay.httpVersionMinor = req.httpVersionMinor;
  replay.socket = req.socket;
  replay.ip = req.ip;
  replay.ips = req.ips;
  replay.body = req.body;
  return replay;
}

/**
 * Normalize the request URL to the full path the middleware prefixes
 * expect (/api/...). Vercel delivers URLs relative to the api/ mount; a
 * plain Node server (or a proxy) may already carry the full path.
 *
 * @param {string} url
 * @returns {string}
 */
function fullApiUrl(url) {
  const pathOnly = (url || '/').split('?')[0];
  if (pathOnly.startsWith('/api/') || pathOnly === '/api') return url || '/';
  return '/api' + (pathOnly.startsWith('/') ? pathOnly : `/${pathOnly}`)
    + (url && url.includes('?') ? url.slice(url.indexOf('?')) : '');
}

/**
 * Vercel function handler (Node.js runtime): `export default gevHandler`.
 *
 * @param {object} req  Node IncomingMessage (Vercel may pre-parse req.body)
 * @param {object} res  Node ServerResponse
 * @returns {Promise<void>}
 */
export async function gevHandler(req, res) {
  let handlers;
  try {
    handlers = await buildHandlers();
  } catch (error) {
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'API failed to initialize' }));
    }
    return;
  }

  const fullUrl = fullApiUrl(req.url);
  let proxied = null;

  for (const { prefix, fn } of handlers) {
    if (!fullUrl.startsWith(prefix)) continue;
    const rest = fullUrl.slice(prefix.length);
    // Boundary check on the PATH part only: /api/opensky?x=1 must match the
    // /api/opensky mount (restPath === '') but /api/opensky-track must not.
    const restPath = rest.split('?')[0];
    if (restPath && !restPath.startsWith('/')) continue; // boundary: /api/opensky-track ≠ /api/opensky

    if (!proxied) proxied = await bridgeRequest(req);
    proxied.url = rest ? (rest.startsWith('/') ? rest : `/${rest}`) : '/';

    try {
      const result = fn(proxied, res);
      if (result && typeof result.catch === 'function') {
        try {
          await result;
        } catch (error) {
          console.error('[gev] handler rejected:', error?.stack || error);
          if (!res.headersSent && !res.writableEnded) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.end('Internal Error\n');
          }
        }
      }
    } catch (error) {
      console.error('[gev] handler threw:', error?.stack || error);
      if (!res.headersSent && !res.writableEnded) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end('Internal Error\n');
      }
    }

    if (res.writableEnded || res.headersSent) return;
  }

  if (!res.headersSent) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Not found' }));
  }
}
