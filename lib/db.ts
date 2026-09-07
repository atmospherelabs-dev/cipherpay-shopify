import crypto from 'crypto';
import { Redis } from '@upstash/redis';
import { Client as QStashClient } from '@upstash/qstash';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

let _qstash: QStashClient | null = null;
function getQStash(): QStashClient {
  if (!_qstash) {
    const token = process.env.QSTASH_TOKEN;
    if (!token) throw new Error('QSTASH_TOKEN is required for deploy job scheduling');
    _qstash = new QStashClient({ token });
  }
  return _qstash;
}

export interface Shop {
  shop: string;
  access_token: string;
  shopify_app_client_id: string | null;
  cipherpay_api_key: string | null;
  cipherpay_api_url: string;
  cipherpay_webhook_secret: string | null;
}

export interface ShopifyAppCredentials {
  client_id: string;
  client_secret: string;
  shop_domain: string | null;
  created_at: string;
  updated_at: string;
}

export interface ShopifyOAuthState {
  nonce: string;
  shop: string;
  client_id: string | null;
  created_at: string;
}

export interface ShopifyDeployJob {
  id: string;
  client_id: string;
  app_name: string;
  host: string;
  encrypted_automation_token: string;
  created_at: string;
}

export interface ShopifyDeployStatus {
  id: string;
  client_id: string;
  app_name: string;
  status: 'queued' | 'processing' | 'deployed' | 'failed';
  created_at: string;
  updated_at: string;
  error: string | null;
}

export interface PendingShopConfig {
  shop: string;
  cipherpay_api_key: string;
  cipherpay_api_url: string;
  cipherpay_webhook_secret: string;
  created_at: string;
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
function pendingShopConfigKey(shop: string) { return `pending-shop-config:${shop}`; }
function shopifyAppKey(clientId: string) { return `shopify-app:${clientId}`; }
function shopifyAppShopKey(shop: string) { return `shopify-app-shop:${shop}`; }
function shopifyOAuthStateKey(nonce: string) { return `shopify-oauth-state:${nonce}`; }
function shopifyDeployJobKey(id: string) { return `shopify-deploy-job:${id}`; }
function shopifyDeployStatusKey(id: string) { return `shopify-deploy-status:${id}`; }
function sessionKey(id: string) { return `session:${id}`; }
function invoiceMapKey(invoiceId: string) { return `invoice:${invoiceId}`; }
function orderMapKey(shop: string, orderId: string) { return `order:${shop}:${orderId}`; }

function credentialEncryptionKey(): Buffer {
  const value = process.env.SHOPIFY_CREDENTIALS_KEY;
  if (!value) {
    throw new Error('SHOPIFY_CREDENTIALS_KEY is required to store Shopify app credentials');
  }

  if (/^[a-f0-9]{64}$/i.test(value)) {
    return Buffer.from(value, 'hex');
  }

  const base64 = Buffer.from(value, 'base64');
  if (base64.length === 32) {
    return base64;
  }

  // Allows passphrase-style secrets while still feeding AES-256-GCM a 32-byte key.
  return crypto.createHash('sha256').update(value).digest();
}

function encryptSecret(secret: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', credentialEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
}

function decryptSecret(encryptedSecret: string): string {
  const [version, iv, authTag, encrypted] = encryptedSecret.split(':');
  if (version !== 'v1' || !iv || !authTag || !encrypted) {
    throw new Error('Invalid encrypted Shopify credential format');
  }

  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    credentialEncryptionKey(),
    Buffer.from(iv, 'base64')
  );
  decipher.setAuthTag(Buffer.from(authTag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

const secretFields = ['access_token', 'cipherpay_api_key', 'cipherpay_webhook_secret'] as const;
function protectSecrets<T extends object>(data: T): string {
  const stored = { ...data } as Record<string, unknown>;
  for (const field of secretFields) {
    if (typeof stored[field] === 'string' && stored[field]) stored[field] = encryptSecret(stored[field] as string);
  }
  return JSON.stringify({ ...stored, encryption_version: 1 });
}
function revealSecrets<T>(data: unknown): T {
  const stored = (typeof data === 'string' ? JSON.parse(data) : data) as Record<string, unknown>;
  if (stored.encryption_version === 1) {
    for (const field of secretFields) {
      if (typeof stored[field] === 'string' && stored[field]) stored[field] = decryptSecret(stored[field] as string);
    }
  }
  delete stored.encryption_version;
  return stored as T;
}

export async function saveShop(shop: string, accessToken: string, shopifyAppClientId?: string | null): Promise<void> {
  const existing = await getShop(shop);
  const pendingConfig = await getPendingShopConfig(shop);
  const data: Shop = {
    shop,
    access_token: accessToken,
    shopify_app_client_id: shopifyAppClientId ?? existing?.shopify_app_client_id ?? null,
    cipherpay_api_key: existing?.cipherpay_api_key ?? pendingConfig?.cipherpay_api_key ?? null,
    cipherpay_api_url: existing?.cipherpay_api_url ?? pendingConfig?.cipherpay_api_url ?? 'https://api.cipherpay.app',
    cipherpay_webhook_secret: existing?.cipherpay_webhook_secret ?? pendingConfig?.cipherpay_webhook_secret ?? null,
  };
  await redis.set(shopKey(shop), protectSecrets(data));
  if (pendingConfig) {
    await redis.del(pendingShopConfigKey(shop));
  }
}

export async function getShop(shop: string): Promise<Shop | null> {
  const data = await redis.get<string>(shopKey(shop));
  if (!data) return null;
  const shopData = revealSecrets<Shop>(data);
  return {
    ...shopData,
    shopify_app_client_id: shopData.shopify_app_client_id ?? null,
  };
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

  await redis.set(shopKey(shop), protectSecrets(existing));
}

export async function savePendingShopConfig(
  shop: string,
  config: {
    cipherpay_api_key: string;
    cipherpay_api_url: string;
    cipherpay_webhook_secret: string;
  }
): Promise<void> {
  const data: PendingShopConfig = {
    shop,
    cipherpay_api_key: config.cipherpay_api_key,
    cipherpay_api_url: config.cipherpay_api_url,
    cipherpay_webhook_secret: config.cipherpay_webhook_secret,
    created_at: new Date().toISOString(),
  };
  await redis.set(pendingShopConfigKey(shop), protectSecrets(data), { ex: 86400 });
}

export async function getPendingShopConfig(shop: string): Promise<PendingShopConfig | null> {
  const data = await redis.get<string>(pendingShopConfigKey(shop));
  if (!data) return null;
  return revealSecrets<PendingShopConfig>(data);
}

export async function saveShopifyAppCredentials(
  clientId: string,
  clientSecret: string,
  shopDomain?: string | null
): Promise<void> {
  const existing = await getShopifyAppCredentials(clientId);
  const now = new Date().toISOString();
  const data = {
    client_id: clientId,
    encrypted_client_secret: encryptSecret(clientSecret),
    shop_domain: shopDomain ?? existing?.shop_domain ?? null,
    created_at: existing?.created_at ?? now,
    updated_at: now,
  };

  await redis.set(shopifyAppKey(clientId), JSON.stringify(data));
  if (data.shop_domain) {
    await redis.set(shopifyAppShopKey(data.shop_domain), clientId);
  }
}

export async function getShopifyAppCredentials(clientId: string): Promise<ShopifyAppCredentials | null> {
  const data = await redis.get<string>(shopifyAppKey(clientId));
  if (!data) return null;

  const parsed = typeof data === 'string' ? JSON.parse(data) : data as {
    client_id: string;
    encrypted_client_secret: string;
    shop_domain: string | null;
    created_at: string;
    updated_at: string;
  };

  return {
    client_id: parsed.client_id,
    client_secret: decryptSecret(parsed.encrypted_client_secret),
    shop_domain: parsed.shop_domain ?? null,
    created_at: parsed.created_at,
    updated_at: parsed.updated_at,
  };
}

export async function getShopifyAppCredentialsByShop(shop: string): Promise<ShopifyAppCredentials | null> {
  const shopData = await getShop(shop);
  if (shopData?.shopify_app_client_id) {
    return getShopifyAppCredentials(shopData.shopify_app_client_id);
  }

  const clientId = await redis.get<string>(shopifyAppShopKey(shop));
  if (!clientId) return null;
  return getShopifyAppCredentials(typeof clientId === 'string' ? clientId : String(clientId));
}

export async function saveShopifyOAuthState(
  nonce: string,
  shop: string,
  clientId?: string | null
): Promise<void> {
  const data: ShopifyOAuthState = {
    nonce,
    shop,
    client_id: clientId ?? null,
    created_at: new Date().toISOString(),
  };
  await redis.set(shopifyOAuthStateKey(nonce), JSON.stringify(data), { ex: 600 });
}

export async function getShopifyOAuthState(nonce: string): Promise<ShopifyOAuthState | null> {
  const data = await redis.get<string>(shopifyOAuthStateKey(nonce));
  if (!data) return null;
  return typeof data === 'string' ? JSON.parse(data) : data as unknown as ShopifyOAuthState;
}

export async function deleteShopifyOAuthState(nonce: string): Promise<void> {
  await redis.del(shopifyOAuthStateKey(nonce));
}

export async function enqueueShopifyDeployJob(
  clientId: string,
  automationToken: string,
  appName = 'CipherPay',
  host = process.env.HOST || 'https://connect.cipherpay.app'
): Promise<ShopifyDeployStatus> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const job: ShopifyDeployJob = {
    id,
    client_id: clientId,
    app_name: appName,
    host,
    encrypted_automation_token: encryptSecret(automationToken),
    created_at: now,
  };
  const status: ShopifyDeployStatus = {
    id,
    client_id: clientId,
    app_name: appName,
    status: 'queued',
    created_at: now,
    updated_at: now,
    error: null,
  };

  await redis.set(shopifyDeployJobKey(id), JSON.stringify(job), { ex: 900 });
  await redis.set(shopifyDeployStatusKey(id), JSON.stringify(status), { ex: 86400 });

  const workerUrl = process.env.SHOPIFY_DEPLOY_WORKER_URL;
  if (!workerUrl) throw new Error('SHOPIFY_DEPLOY_WORKER_URL is required for deploy job scheduling');
  await getQStash().publishJSON({
    url: `${workerUrl}/deploy`,
    body: { jobId: id },
    retries: 2,
  });

  return status;
}

export async function getShopifyDeployStatus(id: string): Promise<ShopifyDeployStatus | null> {
  const data = await redis.get<string>(shopifyDeployStatusKey(id));
  if (!data) return null;
  return typeof data === 'string' ? JSON.parse(data) : data as unknown as ShopifyDeployStatus;
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
  await redis.set(sessionKey(session.id), JSON.stringify(data), { ex: 2592000 });

  if (session.cipherpay_invoice_id) {
    await redis.set(invoiceMapKey(session.cipherpay_invoice_id), session.id, { ex: 2592000 });
  }
  if (session.shopify_order_id) {
    await redis.set(orderMapKey(session.shop, session.shopify_order_id), session.id, { ex: 2592000 });
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
  await redis.eval(`
    local raw = redis.call('get', KEYS[1])
    if not raw then return 0 end
    local session = cjson.decode(raw)
    local updates = cjson.decode(ARGV[1])
    if updates.cipherpay_invoice_id then session.cipherpay_invoice_id = updates.cipherpay_invoice_id end
    if updates.shopify_order_id then session.shopify_order_id = updates.shopify_order_id end
    if updates.status and session.status ~= 'confirmed' and session.status ~= 'refunded' then
      if updates.status == 'confirmed' or session.status == 'pending' or session.status == 'detected' then session.status = updates.status end
    end
    redis.call('set', KEYS[1], cjson.encode(session), 'EX', 2592000)
    return 1`, [sessionKey(id)], [JSON.stringify(updates)]);
  if (updates.cipherpay_invoice_id) await redis.set(invoiceMapKey(updates.cipherpay_invoice_id), id, { ex: 2592000 });

}

export async function deleteShop(shop: string): Promise<void> {
  const existing = await getShop(shop);
  if (existing?.shopify_app_client_id) {
    await redis.del(shopifyAppKey(existing.shopify_app_client_id));
  }
  // Remove legacy mappings too, including records created before the repair.
  for (const pattern of ['session:*', 'sps:*', `st:${shop}:*`, `st-v2:${shop}:*`]) {
    let cursor = 0;
    do {
      const page = await redis.scan(cursor, { match: pattern, count: 100 });
      cursor = Number(page[0]);
      for (const key of page[1]) {
        if (pattern.startsWith('st')) { await redis.del(key); continue; }
        const raw = await redis.get(key);
        const data = typeof raw === 'string' ? JSON.parse(raw) : raw as PaymentSession | null;
        if (data?.shop !== shop) continue;
        await redis.del(key);
        if (data.cipherpay_invoice_id) await redis.del(invoiceMapKey(data.cipherpay_invoice_id), spInvoiceMapKey(data.cipherpay_invoice_id));
        if (data.shopify_order_id) await redis.del(orderMapKey(shop, data.shopify_order_id));
      }
    } while (cursor !== 0);
  }
  for (const id of await redis.smembers<string[]>('fulfillment-pending')) {
    const job = await getFulfillment(id);
    if (job?.shop === shop) { await redis.srem('fulfillment-pending',id); await redis.del(`fulfillment:${id}`); }
  }
  await redis.del(shopifyAppShopKey(shop));
  const tokens = await redis.smembers<string[]>(`shop-sessions:${shop}`);
  if (tokens.length) await redis.del(...tokens);
  await redis.del(`shop-sessions:${shop}`, pendingShopConfigKey(shop), shopKey(shop));
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
  await redis.set(spSessionKey(session.id), JSON.stringify(session), { ex: 2592000 });
  if (session.cipherpay_invoice_id) {
    await redis.set(spInvoiceMapKey(session.cipherpay_invoice_id), session.id, { ex: 2592000 });
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
      await redis.set(spInvoiceMapKey(updates.cipherpay_invoice_id), id, { ex: 2592000 });
    }
  }
  if (updates.status !== undefined && session.status === 'pending') session.status = updates.status;

  await redis.set(spSessionKey(id), JSON.stringify(session), { ex: 2592000 });
}

// --- Session Tokens (post-OAuth settings auth) ---

function sessionTokenKey(shop: string, token: string) { return `st-v2:${shop}:${crypto.createHash('sha256').update(token).digest('hex')}`; }

export async function saveSessionToken(shop: string, token: string): Promise<void> {
  await redis.set(sessionTokenKey(shop, token), 'valid', { ex: 86400 });
  await redis.sadd(`shop-sessions:${shop}`, sessionTokenKey(shop, token));
  await redis.expire(`shop-sessions:${shop}`, 172800);
}

export async function verifySessionToken(shop: string, token: string): Promise<boolean> {
  if (!await getShop(shop)) return false;
  const val = await redis.get(sessionTokenKey(shop, token));
  return val === 'valid' || val === '1' || val === 1;
}

// Durable, authenticated fulfillment inbox. Only completed jobs expire; failed jobs remain visible.
export async function saveFulfillment(invoiceId: string, event: string, shop: string): Promise<string> {
  const id = `${invoiceId}:${event}`;
  await redis.set(`fulfillment:${id}`, JSON.stringify({ invoiceId, event, shop }), { nx: true });
  await redis.sadd('fulfillment-pending', id);
  return id;
}
export async function getFulfillment(id: string): Promise<{ invoiceId: string; event: string; shop: string } | null> {
  const data = await redis.get(`fulfillment:${id}`);
  return data ? (typeof data === 'string' ? JSON.parse(data) : data) as { invoiceId: string; event: string; shop: string } : null;
}
export async function pendingFulfillments(): Promise<string[]> {
  // Sample across the entire backlog so a permanently failing job cannot starve newer payments.
  return (await redis.srandmember<string[]>('fulfillment-pending', 50)) ?? [];
}
export async function completeFulfillment(id: string): Promise<void> {
  await redis.srem('fulfillment-pending', id);
  await redis.expire(`fulfillment:${id}`, 2592000);
}
export async function acquireFulfillmentLock(invoiceId: string): Promise<string | null> {
  const token = crypto.randomUUID();
  return await redis.set(`fulfillment-lock:${invoiceId}`, token, { nx: true, ex: 120 }) === 'OK' ? token : null;
}
export async function releaseFulfillmentLock(invoiceId: string, token: string): Promise<void> {
  await redis.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", [`fulfillment-lock:${invoiceId}`], [token]);
}

/** Operator migration, safe to rerun. Returns counts only, never credentials. */
export async function migrateOperationalSecrets(): Promise<number> {
  let migrated = 0;
  for (const pattern of ['shop:*', 'pending-shop-config:*']) {
    let cursor = 0;
    do {
      const [next, keys] = await redis.scan(cursor, { match: pattern, count: 100 });
      cursor = Number(next);
      for (const key of keys) {
        const raw = await redis.get(key);
        const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (data && (data as { encryption_version?: number }).encryption_version !== 1) {
          const ttl = await redis.ttl(key);
          // Compare-and-set prevents overwriting a concurrent configuration change.
          const encoded = protectSecrets(data as object);
          migrated += Number(await redis.eval(`local raw = redis.call('get', KEYS[1]); if raw == ARGV[1] then redis.call('set', KEYS[1], ARGV[2]); if tonumber(ARGV[3]) > 0 then redis.call('expire', KEYS[1], ARGV[3]) end; return 1 else return 0 end`,
            [key], [typeof raw === 'string' ? raw : JSON.stringify(raw), encoded, ttl]));
        }
      }
    } while (cursor !== 0);
  }
  return migrated;
}
