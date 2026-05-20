# Shopify deploy worker

The Shopify deploy worker processes one-time merchant app deployment jobs from
Upstash Redis. It is intended to run on a small private VPS, not in Vercel.

## Required environment

Use the same values as the Vercel Shopify app deployment:

```bash
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
SHOPIFY_CREDENTIALS_KEY=...
HOST=https://connect.cipherpay.app
```

Optional:

```bash
SHOPIFY_DEPLOY_WORKER_POLL_MS=5000
```

## Run

From the `cipherpay-shopify` repo root:

```bash
npm ci
npm run worker:shopify
```

The worker:

- pulls one job at a time from `shopify-deploy-queue`
- decrypts the one-time Shopify app automation token in memory
- writes a temporary `shopify.app.worker-*.toml`
- runs `npx shopify app deploy --allow-updates`
- deletes the temp config
- deletes the encrypted job payload
- stores only redacted deploy status

Run it as a dedicated non-root user on the VPS and keep concurrency at one
worker process unless deployment volume requires otherwise.
