/**
 * Vercel serverless entry for the God's Eye View API.
 *
 * Import order matters: the runtime patch must run before the adapter
 * (which pulls in the endpoint module) so the endpoint module's top-level
 * path computation sees the patched cwd and fs.
 *
 * Every /api/* request routes here (Vercel zero-config `api/` convention).
 */
import '../src/server/gev-runtime-patch.mjs';
import { gevHandler } from '../src/server/gev-vercel-adapter.mjs';

export default function handler(req, res) {
  return gevHandler(req, res);
}
