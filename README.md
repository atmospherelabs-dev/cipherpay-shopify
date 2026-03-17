# CipherPay for Shopify

Accept shielded Zcash (ZEC) payments on your Shopify store. Non-custodial, private, instant detection.

Powered by [CipherPay](https://cipherpay.app).

## How It Works

```
Customer checkout → selects "Pay with Zcash" →
→ Shopify creates order (pending) →
→ Checkout script creates CipherPay invoice →
→ Customer redirected to CipherPay hosted checkout →
→ Customer pays with shielded ZEC →
→ CipherPay confirms → webhook → Shopify order marked as paid
```

Funds go directly to the merchant's Zcash wallet. CipherPay never holds funds.

## Merchant Setup

### Prerequisites

- A Shopify store
- A [CipherPay](https://cipherpay.app) merchant account (free)
- Your CipherPay **API Key** and **Webhook Secret** (from the dashboard)

### Step 1: Install the App

Visit the install page and enter your Shopify store URL:

```
https://connect.cipherpay.app
```

Authorize the app when prompted.

### Step 2: Configure CipherPay Credentials

After installation, you'll be redirected to the settings page. Enter:

- **CipherPay API Key** — from your CipherPay dashboard → Settings → API Keys
- **CipherPay Webhook Secret** — from your CipherPay dashboard → Settings → Webhook Secret
- **API URL** — use `https://api.cipherpay.app` for production, or `https://api.testnet.cipherpay.app` for testing

### Step 3: Add Payment Method in Shopify

1. In your Shopify admin, go to **Settings → Payments**
2. Scroll to **Manual payment methods**
3. Click **Add manual payment method**
4. Name it: `Pay with Zcash (ZEC)`
5. Optional: add instructions like "You'll be redirected to pay with shielded ZEC after placing your order."

### Step 4: Add Checkout Script

1. In your Shopify admin, go to **Settings → Checkout**
2. Scroll to **Additional scripts** (Order status page)
3. Paste the following script tag:

```html
<script src="https://connect.cipherpay.app/checkout.js" data-shop="YOUR-STORE.myshopify.com"></script>
```

Replace `YOUR-STORE.myshopify.com` with your actual Shopify domain.

### Step 5: Set Webhook URL in CipherPay

In your CipherPay dashboard → Settings → Webhook URL, set:

```
https://connect.cipherpay.app/api/webhook/cipherpay
```

### Step 6: Test

1. Place a test order on your store
2. Select "Pay with Zcash (ZEC)" at checkout
3. Complete the order — you'll be redirected to CipherPay's checkout page
4. Pay with ZEC (use testnet for testing)
5. Once confirmed, the Shopify order is automatically marked as paid

## Development

```bash
# Clone
git clone git@github.com:atmospherelabs-dev/cipherpay-shopify.git
cd cipherpay-shopify

# Install
npm install

# Configure
cp .env.example .env
# Fill in your Shopify Partner app credentials

# Run
npm run dev
```

For local development, use [ngrok](https://ngrok.com) to expose your dev server:

```bash
ngrok http 3002
```

Then set `HOST` in `.env` to your ngrok URL and update your Shopify app's redirect URLs accordingly.

## Architecture

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  Shopify Store   │────▶│  This App        │────▶│  CipherPay API   │
│  (merchant)      │     │  (bridge)        │     │  (payment)       │
└──────────────────┘     └──────────────────┘     └──────────────────┘
                               │                        │
                         ┌─────┴─────┐            ┌─────┴─────┐
                         │  SQLite   │            │  Scanner  │
                         │  (sessions)│            │  (Zcash)  │
                         └───────────┘            └───────────┘
```

- **Shopify OAuth** — secure app installation
- **Payment sessions** — tracks invoice ↔ order mapping
- **HMAC verification** — validates both Shopify and CipherPay webhooks
- **SQLite** — lightweight session storage (no external DB needed)

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SHOPIFY_API_KEY` | From your Shopify Partner dashboard |
| `SHOPIFY_API_SECRET` | From your Shopify Partner dashboard |
| `SHOPIFY_SCOPES` | API permissions (default: `read_orders,write_orders`) |
| `HOST` | Your app's public URL |
| `CIPHERPAY_API_URL` | Default CipherPay API URL |

## Related

- **[CipherPay](https://cipherpay.app)** — Zcash payment gateway
- **[CipherPay API](https://github.com/atmospherelabs-dev/cipherpay-api)** — Rust backend
- **[CipherPay Web](https://github.com/atmospherelabs-dev/cipherpay-web)** — Dashboard & checkout frontend
- **[CipherScan](https://cipherscan.app)** — Zcash blockchain explorer

## License

MIT
