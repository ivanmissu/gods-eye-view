# Deploying God's Eye View

This app **cannot** run on GitHub Pages, Netlify's static tier, or any other
purely static host. About 25 API endpoints (the CCTV frame proxy, flights,
satellites, geocoding, weather, radio) live in the Vite server. Without Node
running, the globe loads and every data layer 404s.

A full-Node host (Node 24.14.x or 26.x) or a serverless platform that can run
the API middlewares as functions (Vercel — see below) works.

## One-click: Vercel (serverless functions)

The API middlewares are extracted from the Vite config into
`src/server/gev-endpoints.mjs` (no Vite imports), so they can be mounted on
Vercel serverless functions without a long-lived Node process:

- `api/[...gev].mjs` — Vercel catch-all entry for every `/api/*` route.
- `src/server/gev-vercel-adapter.mjs` — replays the plugin registration and
  dispatches requests through the same Connect chain the dev server uses,
  bridging Vercel's pre-parsed request body back into a raw stream.
- `src/server/gev-runtime-patch.mjs` — serverless runtime prep: a writable
  temp mirror for the `.gev-cache`/`.gev-logs`/`data`/`config` segments, a
  `process.cwd()` remap, and a vendored `ws` loader (the optional dev
  dependency is not in the function bundle).
- `src/server/embedded-data.mjs` — shipped data files (CCTV registries,
  compiled datasets, CelesTrak TLE seeds) embedded in the bundle, regenerated
  with `node scripts/embed-server-data.mjs` when they change.
- `vercel.json` — Node 22 function runtime, install/build commands, SPA
  rewrites.

Deploy:

1. In Vercel, import this repository (GitHub integration) or run
   `npx vercel` from a checkout.
2. Set `GOOGLE_MAPS_API_KEY` as a project environment variable (all
   targets). It is read at build time (injected into the client bundle) and
   at runtime (the Google Places / Street View endpoints).
3. Wait for the build (`npm ci --ignore-scripts` + `vite build`).

`node scripts/test-vercel-adapter.mjs` exercises the deployed function over
local HTTP before you ship it.

Serverless caveats (the endpoints already degrade honestly where they hit
them):

- **Per-instance state.** In-memory caches, the AISStream websocket, and the
  disk caches live on the function instance and reset on cold start; a fresh
  instance refetches/refills on demand.
- **Long-running responses.** Fluid Compute (on by default on new Vercel
  projects) allows up to 300 s, which covers the slowest proxies; on a plan
  without it, very slow upstreams time out and the layer reports the error.
- **Voice control.** The OpenAI Realtime endpoints are served by the dev /
  preview server and Render; on Vercel they are not mounted (they require
  `OPENAI_API_KEY` and the frozen tool-schema baseline lives in
  `vite.config.js`, which the function deliberately does not import).

## One-click: Render (free tier)

The repo carries a `render.yaml` Blueprint, so Render configures itself.

1. Go to <https://render.com> and sign in **with GitHub**.
2. **New → Blueprint**, pick this repository, click **Apply**.
3. When prompted, paste your `GOOGLE_MAPS_API_KEY`. It is the only required
   secret, and it is never committed — `.env` is gitignored.
4. Wait for the first build (a few minutes; the Cesium bundle is large).

After that, **every `git push` to the default branch redeploys automatically** —
`autoDeploy: true` in the Blueprint.

### Restrict your Google key BEFORE the site is public

The key is injected into the browser bundle by design and is readable by anyone
who opens devtools. Map Tiles is billed per session, so an unrestricted key on a
public URL is a genuine financial risk.

Google Cloud Console → APIs & Services → Credentials → your key →
**Application restrictions → Websites** → add `https://<your-app>.onrender.com/*`.
Then **API restrictions** → limit it to Map Tiles, Geocoding, Places (New) and
Street View Static.

### Free-tier caveat

Render's free web services sleep after ~15 minutes idle and take ~30–60 seconds
to wake. Fine for a personal deployment; upgrade if you want it always warm.

## Camera licensing — read this before widening the deployment

Public visibility is not permission to redistribute. `render.yaml` deliberately
disables the packs whose terms forbid it:

| Pack | Cameras | Terms |
|---|---|---|
| FDOT FL511 (Miami) | 887 | *"individual use only … not available for re-sale or re-use without the express written consent of FDOT"* |
| Autostrade (Italy) | ~700 | All rights reserved |
| GMCVB / Ozolio | 4 | Permission required |
| WeatherSTEM | 2 | Written permission required |
| Vedetta | 1 | No terms published |
| SANRAL (South Africa) | 1,238 | Already disabled in the registry |
| BayernInfo (Bavaria) | 946 | Personal / non-commercial only — never added |

Everything left enabled is openly licensed: Open Government Licence (BC,
Ontario, Toronto, Calgary), CC BY 4.0 (Finland, Spanish cities, Queensland),
CC0 (Sweden), NLOD (Norway), CC BY (NSW), CC BY-SA (Illinois), and Hong Kong,
whose terms expressly permit commercial use free of charge.

Your **local** instance keeps all of them — `.env` is untouched by any of this.
Drafts for the three permission emails are in
`docs/licensing/PERMISSION-REQUESTS.md`; once a reply lands, remove that pack's
`_ENABLED=0` line from `render.yaml`.

## Other hosts

Anything that runs Node works the same way:

```bash
npm ci && npm run build
PORT=8080 npm start
```

Railway and Fly.io need only that plus the same environment variables.
Vercel is supported via the serverless-function port above; Cloudflare Pages
would need the same porting work.
