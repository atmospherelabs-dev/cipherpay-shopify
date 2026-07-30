# Shopify deploy worker

The Shopify deploy worker processes merchant app deployment jobs delivered via
Upstash QStash. It listens for signed HTTP POST requests — no polling, no idle
Redis usage.

## Required environment

### Vercel (Next.js app)

These are set in Vercel env vars so the app can publish deploy jobs to QStash:

```bash
QSTASH_TOKEN=...
SHOPIFY_DEPLOY_WORKER_URL=https://deploy.yourdomain.com
```

### VPS (deploy worker)

```bash
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
SHOPIFY_CREDENTIALS_KEY=...
HOST=https://connect.cipherpay.app

# QStash signature verification (from console.upstash.com → QStash → Signing Keys)
QSTASH_CURRENT_SIGNING_KEY=...
QSTASH_NEXT_SIGNING_KEY=...
```

Optional:

```bash
DEPLOY_WORKER_PORT=9100
```

## Run

From the `cipherpay-shopify` repo root:

```bash
npm ci
npm run worker:shopify
```

## How it works

1. Merchant onboards → Vercel app calls `enqueueShopifyDeployJob`
2. Job data + status stored in Redis; job ID published to QStash
3. QStash delivers a signed POST to `https://deploy.yourdomain.com/deploy`
4. Worker verifies the QStash signature, fetches the job from Redis
5. Writes a temporary `shopify.app.worker-*.toml`
6. Runs `npx shopify app deploy --allow-updates`
7. Deletes the temp config and encrypted job payload
8. Stores only redacted deploy status

QStash retries delivery on 5xx responses (up to 2 retries). If the job data
has already been consumed or expired, the worker returns 200 and no-ops.

## Reverse proxy

The worker listens on `DEPLOY_WORKER_PORT` (default 9100). Point your reverse
proxy (Caddy/nginx) at this port and expose it on the `SHOPIFY_DEPLOY_WORKER_URL`
hostname. HTTPS is required — QStash only delivers to HTTPS endpoints.

Caddy example:

```
deploy.yourdomain.com {
    reverse_proxy localhost:9100
}
```

## Security

- QStash signature verification rejects unsigned or forged requests
- The `/deploy` endpoint is the only accepted path; all others return 404
- Encrypted automation tokens are decrypted in memory and wiped after use
- Deploy output is sanitized to strip any leaked tokens before storage

Run as a dedicated non-root user on the VPS.
