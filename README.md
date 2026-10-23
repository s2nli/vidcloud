# vidcloud-proxy (Vercel)

Deploy: push this folder to GitHub -> Import in Vercel (no build settings needed), or `vercel --prod`.

Use:
- Upstream  https://vidcloud.eu.org/api/<x>   ->   https://YOUR-APP.vercel.app/api/<x>
- Check tokens work:  https://YOUR-APP.vercel.app/api/_token   (should show ok:true)
- Batch list:         https://YOUR-APP.vercel.app/api/_batches

In the app, change:  const API_BASE = "https://YOUR-APP.vercel.app/api";

How it works: fetches access_token + token from /generate_token.php, caches 10 min,
sends them as Bearer / X-Auth-Token / auth_token cookie, retries once on 401/403, adds CORS.

NOTE: upstream header names were guessed (logic is obfuscated). If /api/_token is ok but data
calls give 401/403, send me one "Copy as cURL" of a working request and I'll match headers exactly.
