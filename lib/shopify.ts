import crypto from 'crypto';

const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY!;
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET!;
const SHOPIFY_SCOPES = process.env.SHOPIFY_SCOPES || 'read_orders,write_orders';
const HOST = process.env.HOST!;

export function buildInstallUrl(shop: string): { url: string; state: string } {
  const state = crypto.randomBytes(16).toString('hex');
  const redirectUri = `${HOST}/api/auth/callback`;

  const url = `https://${shop}/admin/oauth/authorize?` +
    `client_id=${SHOPIFY_API_KEY}` +
    `&scope=${SHOPIFY_SCOPES}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${state}`;

  return { url, state };
}

export function verifyHmac(query: Record<string, string>): boolean {
  const { hmac, ...rest } = query;
  if (!hmac) return false;

  const sorted = Object.keys(rest).sort().map(k => `${k}=${rest[k]}`).join('&');
  const computed = crypto
    .createHmac('sha256', SHOPIFY_API_SECRET)
    .update(sorted)
    .digest('hex');

  return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(computed));
}

export async function exchangeCodeForToken(shop: string, code: string): Promise<string> {
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: SHOPIFY_API_KEY,
      client_secret: SHOPIFY_API_SECRET,
      code,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed: ${res.status} ${text}`);
  }

  const data = await res.json();
  return data.access_token;
}

export async function shopifyAdminApi(
  shop: string,
  accessToken: string,
  endpoint: string,
  options: { method?: string; body?: unknown } = {}
) {
  const res = await fetch(`https://${shop}/admin/api/2026-01/${endpoint}`, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Shopify API error: ${res.status} ${text}`);
  }

  return res.json();
}

export async function markOrderAsPaid(
  shop: string,
  accessToken: string,
  orderId: string
): Promise<void> {
  const txRes = await shopifyAdminApi(shop, accessToken, `orders/${orderId}/transactions.json`, {
    method: 'POST',
    body: {
      transaction: {
        kind: 'capture',
        status: 'success',
        source: 'external',
        gateway: 'CipherPay (ZEC)',
      },
    },
  });

  return txRes;
}

export async function registerWebhooks(
  shop: string,
  accessToken: string,
): Promise<void> {
  const host = process.env.HOST || 'https://shopify.cipherpay.app';
  const complianceUrl = `${host}/api/webhook/shopify/compliance`;
  const topics = [
    { topic: 'orders/create', address: `${host}/api/webhook/shopify/orders` },
    { topic: 'app/uninstalled', address: `${host}/api/webhook/shopify` },
    { topic: 'customers/data_request', address: complianceUrl },
    { topic: 'customers/redact', address: complianceUrl },
    { topic: 'shop/redact', address: complianceUrl },
  ];

  const existing = await shopifyAdminApi(shop, accessToken, 'webhooks.json');
  const registeredTopics = (existing.webhooks || []).map((w: { topic: string }) => w.topic);

  for (const { topic, address } of topics) {
    if (!registeredTopics.includes(topic)) {
      await shopifyAdminApi(shop, accessToken, 'webhooks.json', {
        method: 'POST',
        body: {
          webhook: { topic, address, format: 'json' },
        },
      });
      console.log(`Registered webhook: ${topic} → ${address}`);
    }
  }
}

export function verifyWebhookHmac(body: Buffer, hmacHeader: string): boolean {
  try {
    const computed = crypto
      .createHmac('sha256', SHOPIFY_API_SECRET)
      .update(body)
      .digest();
    const provided = Buffer.from(hmacHeader, 'base64');

    if (computed.length !== provided.length) {
      return false;
    }

    return crypto.timingSafeEqual(computed, provided);
  } catch {
    return false;
  }
}
