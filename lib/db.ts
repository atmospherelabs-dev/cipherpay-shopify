import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

export interface Shop {
  shop: string;
  access_token: string;
  cipherpay_api_key: string | null;
  cipherpay_api_url: string;
  cipherpay_webhook_secret: string | null;
}

export interface PaymentSession {
  id: string;
  shop: string;
  shopify_order_id: string | null;
  cipherpay_invoice_id: string | null;
  amount: string;
  currency: string;
  status: string;
}

function shopKey(shop: string) { return `shop:${shop}`; }
function sessionKey(id: string) { return `session:${id}`; }
function invoiceMapKey(invoiceId: string) { return `invoice:${invoiceId}`; }
function orderMapKey(shop: string, orderId: string) { return `order:${shop}:${orderId}`; }

export async function saveShop(shop: string, accessToken: string): Promise<void> {
  const existing = await getShop(shop);
  const data: Shop = {
    shop,
    access_token: accessToken,
    cipherpay_api_key: existing?.cipherpay_api_key ?? null,
    cipherpay_api_url: existing?.cipherpay_api_url ?? 'https://api.cipherpay.app',
    cipherpay_webhook_secret: existing?.cipherpay_webhook_secret ?? null,
  };
  await redis.set(shopKey(shop), JSON.stringify(data));
}

export async function getShop(shop: string): Promise<Shop | null> {
  const data = await redis.get<string>(shopKey(shop));
  if (!data) return null;
  return typeof data === 'string' ? JSON.parse(data) : data as unknown as Shop;
}

export async function updateShopConfig(
  shop: string,
  config: { cipherpay_api_key?: string; cipherpay_api_url?: string; cipherpay_webhook_secret?: string }
): Promise<void> {
  const existing = await getShop(shop);
  if (!existing) return;

  if (config.cipherpay_api_key !== undefined) existing.cipherpay_api_key = config.cipherpay_api_key;
  if (config.cipherpay_api_url !== undefined) existing.cipherpay_api_url = config.cipherpay_api_url;
  if (config.cipherpay_webhook_secret !== undefined) existing.cipherpay_webhook_secret = config.cipherpay_webhook_secret;

  await redis.set(shopKey(shop), JSON.stringify(existing));
}

export async function createPaymentSession(session: {
  id: string;
  shop: string;
  shopify_order_id?: string;
  cipherpay_invoice_id?: string;
  amount: string;
  currency: string;
}): Promise<void> {
  const data: PaymentSession = {
    id: session.id,
    shop: session.shop,
    shopify_order_id: session.shopify_order_id ?? null,
    cipherpay_invoice_id: session.cipherpay_invoice_id ?? null,
    amount: session.amount,
    currency: session.currency,
    status: 'pending',
  };
  // Sessions expire after 24 hours
  await redis.set(sessionKey(session.id), JSON.stringify(data), { ex: 86400 });

  if (session.cipherpay_invoice_id) {
    await redis.set(invoiceMapKey(session.cipherpay_invoice_id), session.id, { ex: 86400 });
  }
  if (session.shopify_order_id) {
    await redis.set(orderMapKey(session.shop, session.shopify_order_id), session.id, { ex: 86400 });
  }
}

export async function getPaymentSession(id: string): Promise<PaymentSession | null> {
  const data = await redis.get<string>(sessionKey(id));
  if (!data) return null;
  return typeof data === 'string' ? JSON.parse(data) : data as unknown as PaymentSession;
}

export async function getPaymentSessionByInvoiceId(invoiceId: string): Promise<PaymentSession | null> {
  const sessionId = await redis.get<string>(invoiceMapKey(invoiceId));
  if (!sessionId) return null;
  return getPaymentSession(typeof sessionId === 'string' ? sessionId : String(sessionId));
}

export async function getPaymentSessionByOrderId(shop: string, orderId: string): Promise<PaymentSession | null> {
  const sessionId = await redis.get<string>(orderMapKey(shop, orderId));
  if (!sessionId) return null;
  return getPaymentSession(typeof sessionId === 'string' ? sessionId : String(sessionId));
}

export async function updatePaymentSession(id: string, updates: {
  cipherpay_invoice_id?: string;
  shopify_order_id?: string;
  status?: string;
}): Promise<void> {
  const session = await getPaymentSession(id);
  if (!session) return;

  if (updates.cipherpay_invoice_id !== undefined) {
    session.cipherpay_invoice_id = updates.cipherpay_invoice_id;
    await redis.set(invoiceMapKey(updates.cipherpay_invoice_id), id, { ex: 86400 });
  }
  if (updates.shopify_order_id !== undefined) session.shopify_order_id = updates.shopify_order_id;
  if (updates.status !== undefined) session.status = updates.status;

  await redis.set(sessionKey(id), JSON.stringify(session), { ex: 86400 });
}

export async function deleteShop(shop: string): Promise<void> {
  await redis.del(shopKey(shop));
}

function orderLockKey(shop: string, orderId: string) { return `lock:order:${shop}:${orderId}`; }

export async function acquireOrderLock(shop: string, orderId: string): Promise<boolean> {
  const result = await redis.set(orderLockKey(shop, orderId), '1', { nx: true, ex: 30 });
  return result === 'OK';
}

// --- Shopify Payments Extension Sessions ---

export interface ShopifyPaymentSession {
  id: string;
  gid: string;
  group: string;
  shop: string;
  amount: string;
  currency: string;
  test: boolean;
  kind: string;
  cancel_url: string;
  cipherpay_invoice_id: string | null;
  status: 'pending' | 'resolved' | 'rejected';
}

function spSessionKey(id: string) { return `sps:${id}`; }
function spInvoiceMapKey(invoiceId: string) { return `sps-inv:${invoiceId}`; }

export async function saveShopifyPaymentSession(session: ShopifyPaymentSession): Promise<void> {
  await redis.set(spSessionKey(session.id), JSON.stringify(session), { ex: 86400 });
  if (session.cipherpay_invoice_id) {
    await redis.set(spInvoiceMapKey(session.cipherpay_invoice_id), session.id, { ex: 86400 });
  }
}

export async function getShopifyPaymentSession(id: string): Promise<ShopifyPaymentSession | null> {
  const data = await redis.get<string>(spSessionKey(id));
  if (!data) return null;
  return typeof data === 'string' ? JSON.parse(data) : data as unknown as ShopifyPaymentSession;
}

export async function getShopifyPaymentSessionByInvoiceId(invoiceId: string): Promise<ShopifyPaymentSession | null> {
  const sessionId = await redis.get<string>(spInvoiceMapKey(invoiceId));
  if (!sessionId) return null;
  return getShopifyPaymentSession(typeof sessionId === 'string' ? sessionId : String(sessionId));
}

export async function updateShopifyPaymentSession(
  id: string,
  updates: Partial<Pick<ShopifyPaymentSession, 'cipherpay_invoice_id' | 'status'>>
): Promise<void> {
  const session = await getShopifyPaymentSession(id);
  if (!session) return;

  if (updates.cipherpay_invoice_id !== undefined) {
    session.cipherpay_invoice_id = updates.cipherpay_invoice_id;
    if (updates.cipherpay_invoice_id) {
      await redis.set(spInvoiceMapKey(updates.cipherpay_invoice_id), id, { ex: 86400 });
    }
  }
  if (updates.status !== undefined) session.status = updates.status;

  await redis.set(spSessionKey(id), JSON.stringify(session), { ex: 86400 });
}

// --- Session Tokens (post-OAuth settings auth) ---

function sessionTokenKey(shop: string, token: string) { return `st:${shop}:${token}`; }

export async function saveSessionToken(shop: string, token: string): Promise<void> {
  const key = sessionTokenKey(shop, token);
  console.log('[db] Saving session token:', key);
  await redis.set(key, 'valid', { ex: 3600 });
  const verify = await redis.get(key);
  console.log('[db] Verify after save:', verify, typeof verify);
}

export async function verifySessionToken(shop: string, token: string): Promise<boolean> {
  const key = sessionTokenKey(shop, token);
  const val = await redis.get(key);
  console.log('[db] verifySessionToken key:', key, 'val:', val, 'type:', typeof val);
  return val === 'valid' || val === '1' || val === 1;
}
