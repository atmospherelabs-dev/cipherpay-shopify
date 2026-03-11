---
name: cipherpay-shopify
description: CipherPay Shopify app — accept Zcash payments on Shopify stores.
metadata:
  author: cipherpay
  version: "1.0.0"
---

# CipherPay Shopify App Rules

Project-specific guidelines for the CipherPay Shopify integration.

## When to Use

These rules apply to ALL work on the Shopify app:
- OAuth install flow
- Webhook handling (Shopify + CipherPay)
- Checkout UI extension (Preact)
- Settings page
- Redis data layer

## Categories

| Category | Priority | Description |
|----------|----------|-------------|
| Security | Critical | HMAC verification, OAuth state, webhook signatures |
| Extension | Critical | Preact + Shopify s-* components only, JSX pragma |
| Webhooks | High | orders/create, app/uninstalled, CipherPay confirmation |
| Dedup | High | Redis SETNX lock to prevent duplicate invoices |
| Data | High | Upstash Redis for shop config and payment sessions |

## Architecture

```
app/
├── api/
│   ├── auth/
│   │   ├── route.ts          # OAuth install initiation
│   │   └── callback/route.ts # OAuth callback + webhook registration
│   ├── extension/
│   │   └── payment/route.ts  # Extension fetches payment URL
│   ├── settings/route.ts     # Merchant settings CRUD (authenticated)
│   └── webhook/
│       ├── shopify/
│       │   ├── route.ts      # app/uninstalled handler
│       │   └── orders/route.ts # orders/create → invoice creation
│       └── cipherpay/route.ts # Payment confirmation → mark order paid
├── settings/page.tsx         # Settings UI
extensions/
└── cipherpay-checkout/
    └── src/
        ├── ThankYouPage.jsx  # Checkout UI extension (Preact)
        └── OrderStatusPage.jsx
lib/
├── db.ts                     # Upstash Redis (shops, sessions, locks)
├── shopify.ts                # OAuth, HMAC, Admin API, webhooks
└── cipherpay.ts              # CipherPay API client
```

## Critical Rules

### 1. Extension JSX Pragma (CRITICAL)
```jsx
/** @jsxImportSource preact */
// MUST be first line in every extension JSX file
// Without this, JSX silently fails in Shopify's sandbox
```

### 2. No HTML Elements in Extensions (CRITICAL)
```jsx
// ❌ NEVER use HTML elements — crashes silently
<div>content</div>

// ✅ ALWAYS use Shopify s-* components
<s-stack>content</s-stack>
<s-box>content</s-box>
```

### 3. Invoice Dedup with Redis Lock (CRITICAL)
```typescript
// Both webhook and extension can create invoices
// Use SETNX atomic lock to prevent duplicates
const lockAcquired = await acquireOrderLock(shop, orderId);
// Lock key: lock:order:{shop}:{orderId}, TTL: 30s
```

### 4. Payment Method Check (CRITICAL)
```typescript
// Only show CipherPay button for Zcash orders
const isZcash = gateway.includes('zcash') || paymentMethod.includes('zec');
if (!isZcash) return { skip: true };
```

### 5. Webhook HMAC Verification (CRITICAL)
```typescript
// Shopify webhooks: x-shopify-hmac-sha256 (base64, SHOPIFY_API_SECRET)
// CipherPay webhooks: x-cipherpay-signature (hex, per-shop webhook_secret)
// NEVER process unverified webhooks
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SHOPIFY_API_KEY` | Shopify app API key |
| `SHOPIFY_API_SECRET` | Shopify app secret (HMAC verification) |
| `SHOPIFY_SCOPES` | OAuth scopes (read_orders,write_orders) |
| `HOST` | App URL (https://shopify.cipherpay.app) |
| `UPSTASH_REDIS_REST_URL` | Redis connection |
| `UPSTASH_REDIS_REST_TOKEN` | Redis auth token |

## Related Projects

- **cipherpay**: Rust backend (invoice creation API)
- **cipherpay-web**: Frontend (checkout page where customers pay)
