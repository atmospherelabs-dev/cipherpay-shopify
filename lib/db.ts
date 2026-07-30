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
  await redis.set(shopKey(shop), JSON.stringify(data));
  if (pendingConfig) {
    await redis.del(pendingShopConfigKey(shop));
  }
}

export async function getShop(shop: string): Promise<Shop | null> {
  const data = await redis.get<string>(shopKey(shop));
  if (!data) return null;
  const shopData = typeof data === 'string' ? JSON.parse(data) : data as unknown as Shop;
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

  await redis.set(shopKey(shop), JSON.stringify(existing));
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
  await redis.set(pendingShopConfigKey(shop), JSON.stringify(data), { ex: 86400 });
}

export async function getPendingShopConfig(shop: string): Promise<PendingShopConfig | null> {
  const data = await redis.get<string>(pendingShopConfigKey(shop));
  if (!data) return null;
  return typeof data === 'string' ? JSON.parse(data) : data as unknown as PendingShopConfig;
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
  const existing = await getShop(shop);
  if (existing?.shopify_app_client_id) {
    await redis.del(shopifyAppKey(existing.shopify_app_client_id));
  }
  await redis.del(shopifyAppShopKey(shop));
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
  await redis.set(sessionTokenKey(shop, token), 'valid', { ex: 2592000 });
}

export async function verifySessionToken(shop: string, token: string): Promise<boolean> {
  const val = await redis.get(sessionTokenKey(shop, token));
  return val === 'valid' || val === '1' || val === 1;
}
