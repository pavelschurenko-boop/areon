# YouScore proxy (Cloudflare Worker)

Hides the YouScore API key from the client. GitHub Pages can only serve static
files, so the frontend (`YouScore/index.html`) calls this worker instead of
`api.youscore.com.ua` directly, and the worker attaches the API key
server-side before forwarding the request.

## One-time setup

```bash
npm install -g wrangler
cd YouScore/worker
wrangler login
wrangler secret put YOUSCORE_API_KEY
# paste: <REDACTED-ROTATED>
```

## Deploy

```bash
cd YouScore/worker
wrangler deploy
```

This prints the worker's URL, e.g. `https://youscore-proxy.<your-subdomain>.workers.dev`.

## Wire up the frontend

Copy that URL into `PROXY_BASE_URL` near the top of the `<script>` block in
`YouScore/index.html`.

## Notes

- `wrangler.toml`'s `ALLOWED_ORIGIN` restricts CORS to the GitHub Pages origin
  (`https://pavelschurenko-boop.github.io`). Update it if the page moves to a
  different URL or custom domain.
- The worker validates the contractor code is numeric before forwarding it,
  and only proxies `GET /usr/{code}` - it won't forward arbitrary paths or
  query params to the upstream API.
- If the YouScore API key ever needs to be rotated, just re-run
  `wrangler secret put YOUSCORE_API_KEY` - no frontend change needed.
