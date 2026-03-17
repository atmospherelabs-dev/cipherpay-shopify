---
name: cipherpay-shopify
description: CipherPay Shopify app — accept Zcash payments on Shopify stores.
metadata:
  author: cipherpay
  version: "2.0.0"
---

# CipherPay Shopify App Rules

Project-specific guidelines for the CipherPay Shopify integration.

## When to Use

These rules apply to ALL work on the Shopify app:
- Shopify Payments Extension (native checkout integration)
- OAuth install flow
- Webhook handling (Shopify + CipherPay)
- Checkout UI extension (Preact) — legacy flow
- Settings page
- Redis data layer

## Categories

| Category | Priority | Description |
|----------|----------|-------------|
| Payments Extension | Critical | Offsite payment flow, session handlers, GraphQL mutations |
| Security | Critical | mTLS, HMAC verification, OAuth state, webhook signatures |
| Extension | Critical | Preact + Shopify s-* components only, JSX pragma |
| Webhooks | High | CipherPay confirmation → paymentSessionResolve |
| Dedup | High | Redis SETNX lock to prevent duplicate invoices |
| Data | High | Upstash Redis for shop config and payment sessions |

## Architecture

```
app/
├── api/
│   ├── auth/
│   │   ├── route.ts               # OAuth install initiation
│   │   └── callback/route.ts      # OAuth callback + webhook registration
│   ├── payments/                   # Shopify Payments Extension endpoints
│   │   ├── session/route.ts       # Payment session → create invoice, return redirect_url
│   │   ├── refund/route.ts        # Refund session → resolve (manual ZEC refund)
│   │   ├── capture/route.ts       # Capture session → auto-resolve (immediate payment)
│   │   ├── void/route.ts          # Void session → resolve
│   │   └── return/route.ts        # Customer return page (pending → redirect to Shopify)
│   ├── extension/
│   │   └── payment/route.ts       # [Legacy] Extension fetches payment URL
│   ├── settings/route.ts          # Merchant settings CRUD (authenticated)
│   └── webhook/
│       ├── shopify/
│       │   ├── route.ts           # app/uninstalled handler
│       │   └── orders/route.ts    # [Legacy] orders/create → invoice creation
│       └── cipherpay/route.ts     # Payment confirmation → paymentSessionResolve + legacy markOrderAsPaid
├── settings/page.tsx              # Settings UI
extensions/
├── cipherpay-payments/            # Shopify Payments Extension (offsite)
│   └── shopify.extension.toml     # Payment session URLs, supported countries/methods
└── cipherpay-checkout/            # [Legacy] Checkout UI extension
    └── src/
        ├── ThankYouPage.jsx       # Thank You page payment button
        └── OrderStatusPage.jsx    # Order Status page payment status
lib/
├── db.ts                          # Upstash Redis (shops, sessions, locks, Shopify payment sessions)
├── shopify.ts                     # OAuth, HMAC, Admin API, webhooks
├── shopify-payments.ts            # Payments Apps GraphQL API (resolve, reject, configure)
└── cipherpay.ts                   # CipherPay API client
```

## Payment Flows

### Native Payments Extension (primary)

```
Customer at checkout
  → Selects "Zcash (ZEC)" in native payment selector (with logo)
  → Clicks "Complete order"
  → Shopify POSTs to /api/payments/session
  → App creates CipherPay invoice, returns redirect_url
  → Customer redirected to CipherPay checkout, pays with ZEC
  → CipherPay webhook → app calls paymentSessionResolve
  → Customer redirected back to Shopify → order confirmed
```

### Legacy Manual Payment (backward compat)

```
Customer at checkout
  → Selects "Pay with Zcash (ZEC)" (manual payment method)
  → Order created as pending
  → Thank You page extension shows "Pay with CipherPay" button
  → Customer clicks → pays on CipherPay checkout
  → CipherPay webhook → markOrderAsPaid
```

## Critical Rules

### 1. Payments Extension Session Handling (CRITICAL)
```typescript
// Shopify POSTs payment session → create invoice → return redirect_url
// After CipherPay confirms → call paymentSessionResolve via GraphQL
// On expiry/cancel → call paymentSessionReject
```

### 2. mTLS Authentication (CRITICAL — Infrastructure)
```
// Production requires mTLS using Shopify's CA certificate.
// Configure at reverse proxy / CDN level (Cloudflare, AWS ALB, etc.)
// Application code verifies shopify-shop-domain header as defense in depth.
```

### 3. Extension JSX Pragma (CRITICAL — Legacy)
```jsx
/** @jsxImportSource preact */
// MUST be first line in every extension JSX file
```

### 4. No HTML Elements in Extensions (CRITICAL — Legacy)
```jsx
// ❌ NEVER use HTML elements — crashes silently
<div>content</div>

// ✅ ALWAYS use Shopify s-* components
<s-stack>content</s-stack>
```

### 5. Webhook HMAC Verification (CRITICAL)
```typescript
// Shopify webhooks: x-shopify-hmac-sha256 (base64, SHOPIFY_API_SECRET)
// CipherPay webhooks: x-cipherpay-signature (hex, per-shop webhook_secret)
// Payment session requests: mTLS only (no HMAC)
// NEVER process unverified webhooks
```

### 6. Idempotent Payment Sessions (CRITICAL)
```typescript
// Shopify may retry payment session requests.
// Use Redis to prevent duplicate invoice creation.
// Payment session IDs are unique — store and check before creating.
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SHOPIFY_API_KEY` | Shopify app API key |
| `SHOPIFY_API_SECRET` | Shopify app secret (HMAC verification) |
| `HOST` | App URL (https://shopify.cipherpay.app) |
| `UPSTASH_REDIS_REST_URL` | Redis connection |
| `UPSTASH_REDIS_REST_TOKEN` | Redis auth token |

## Payments Extension Config

| Field | Value |
|-------|-------|
| Type | `payments_app_extension_offsite` |
| API Version | `2026-01` |
| Payment Method | Zcash (ZEC) |
| buyer_label | "Zcash (ZEC)" |
| merchant_label | "CipherPay — Zcash (ZEC)" |
| 3DS | Not applicable |
| Deferred Payments | No (immediate charge) |
| Installments | No |

## Related Projects

- **cipherpay**: Rust backend (invoice creation API)
- **cipherpay-web**: Frontend (checkout page where customers pay)
