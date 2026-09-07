import crypto from 'crypto';

const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY!;
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET!;
const SHOPIFY_SCOPES = process.env.SHOPIFY_SCOPES || 'read_orders,write_orders';
const HOST = process.env.HOST!;

export function buildInstallUrl(
  shop: string,
  options: { clientId?: string; state?: string } = {}
): { url: string; state: string } {
  const state = options.state ?? crypto.randomBytes(16).toString('hex');
  const clientId = options.clientId ?? SHOPIFY_API_KEY;
  const redirectUri = `${HOST}/api/auth/callback`;

  const url = `https://${shop}/admin/oauth/authorize?` +
    `client_id=${clientId}` +
    `&scope=${SHOPIFY_SCOPES}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${state}`;

  return { url, state };
}

export function verifyHmac(query: Record<string, string>, clientSecret = SHOPIFY_API_SECRET): boolean {
  const { hmac, ...rest } = query;
  if (!hmac) return false;

  const sorted = Object.keys(rest).sort().map(k => `${k}=${rest[k]}`).join('&');
  const computed = crypto
    .createHmac('sha256', clientSecret)
    .update(sorted)
    .digest('hex');

  if (hmac.length !== computed.length) {
    return false;
  }

  return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(computed));
}

export async function exchangeCodeForToken(
  shop: string,
  code: string,
  credentials: { clientId?: string; clientSecret?: string } = {}
): Promise<string> {
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: credentials.clientId ?? SHOPIFY_API_KEY,
      client_secret: credentials.clientSecret ?? SHOPIFY_API_SECRET,
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
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
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
  const { order } = await shopifyAdminApi(shop, accessToken, `orders/${orderId}.json`);
  if (order?.financial_status === 'paid') return;
  if (!order || order.cancelled_at || ['refunded','voided'].includes(order.financial_status)) throw new Error('Order cannot be marked paid');
  const result = await shopifyAdminApi(shop, accessToken, 'graphql.json', {
    method: 'POST', body: {
      query: 'mutation MarkPaid($input: OrderMarkAsPaidInput!) { orderMarkAsPaid(input: $input) { order { id } userErrors { message } } }',
      variables: { input: { id: `gid://shopify/Order/${orderId}` } },
    },
  });
  if (result.errors?.length || result.data?.orderMarkAsPaid?.userErrors?.length || !result.data?.orderMarkAsPaid?.order?.id) {
    // A lost response may follow a successful mutation. Reconcile before retrying.
    const retry = await shopifyAdminApi(shop, accessToken, `orders/${orderId}.json`);
    if (retry.order?.financial_status !== 'paid') throw new Error('Shopify did not confirm payment');
  }

}

export async function registerWebhooks(
  shop: string,
  accessToken: string,
): Promise<void> {
  const host = process.env.HOST || 'https://connect.cipherpay.app';
  // GDPR compliance webhooks are now declared in shopify.app.toml
  const topics = [
    { topic: 'orders/create', address: `${host}/api/webhook/shopify/orders` },
    { topic: 'app/uninstalled', address: `${host}/api/webhook/shopify` },
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

export function verifyWebhookHmac(body: Buffer, hmacHeader: string, clientSecret = SHOPIFY_API_SECRET): boolean {
  try {
    const computed = crypto
      .createHmac('sha256', clientSecret)
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
