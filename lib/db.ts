import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'cipherpay-shopify.db');

let _db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');

    _db.exec(`
      CREATE TABLE IF NOT EXISTS shops (
        shop TEXT PRIMARY KEY,
        access_token TEXT NOT NULL,
        cipherpay_api_key TEXT,
        cipherpay_api_url TEXT DEFAULT 'https://api.cipherpay.app',
        cipherpay_webhook_secret TEXT,
        installed_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS payment_sessions (
        id TEXT PRIMARY KEY,
        shop TEXT NOT NULL,
        shopify_order_id TEXT,
        shopify_order_number TEXT,
        cipherpay_invoice_id TEXT,
        amount TEXT NOT NULL,
        currency TEXT NOT NULL DEFAULT 'EUR',
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (shop) REFERENCES shops(shop) ON DELETE CASCADE
      );
    `);
  }
  return _db;
}

export interface Shop {
  shop: string;
  access_token: string;
  cipherpay_api_key: string | null;
  cipherpay_api_url: string;
  cipherpay_webhook_secret: string | null;
  installed_at: string;
  updated_at: string;
}

export interface PaymentSession {
  id: string;
  shop: string;
  shopify_order_id: string | null;
  shopify_order_number: string | null;
  cipherpay_invoice_id: string | null;
  amount: string;
  currency: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export function saveShop(shop: string, accessToken: string): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO shops (shop, access_token)
    VALUES (?, ?)
    ON CONFLICT(shop) DO UPDATE SET
      access_token = excluded.access_token,
      updated_at = datetime('now')
  `).run(shop, accessToken);
}

export function getShop(shop: string): Shop | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM shops WHERE shop = ?').get(shop) as Shop | undefined;
}

export function updateShopConfig(
  shop: string,
  config: { cipherpay_api_key?: string; cipherpay_api_url?: string; cipherpay_webhook_secret?: string }
): void {
  const db = getDb();
  const fields: string[] = [];
  const values: unknown[] = [];

  if (config.cipherpay_api_key !== undefined) {
    fields.push('cipherpay_api_key = ?');
    values.push(config.cipherpay_api_key);
  }
  if (config.cipherpay_api_url !== undefined) {
    fields.push('cipherpay_api_url = ?');
    values.push(config.cipherpay_api_url);
  }
  if (config.cipherpay_webhook_secret !== undefined) {
    fields.push('cipherpay_webhook_secret = ?');
    values.push(config.cipherpay_webhook_secret);
  }

  if (fields.length === 0) return;

  fields.push("updated_at = datetime('now')");
  values.push(shop);

  db.prepare(`UPDATE shops SET ${fields.join(', ')} WHERE shop = ?`).run(...values);
}

export function createPaymentSession(session: {
  id: string;
  shop: string;
  shopify_order_id?: string;
  shopify_order_number?: string;
  amount: string;
  currency: string;
}): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO payment_sessions (id, shop, shopify_order_id, shopify_order_number, amount, currency)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(session.id, session.shop, session.shopify_order_id ?? null, session.shopify_order_number ?? null, session.amount, session.currency);
}

export function getPaymentSession(id: string): PaymentSession | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM payment_sessions WHERE id = ?').get(id) as PaymentSession | undefined;
}

export function getPaymentSessionByInvoiceId(invoiceId: string): PaymentSession | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM payment_sessions WHERE cipherpay_invoice_id = ?').get(invoiceId) as PaymentSession | undefined;
}

export function updatePaymentSession(id: string, updates: {
  cipherpay_invoice_id?: string;
  shopify_order_id?: string;
  status?: string;
}): void {
  const db = getDb();
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.cipherpay_invoice_id !== undefined) {
    fields.push('cipherpay_invoice_id = ?');
    values.push(updates.cipherpay_invoice_id);
  }
  if (updates.shopify_order_id !== undefined) {
    fields.push('shopify_order_id = ?');
    values.push(updates.shopify_order_id);
  }
  if (updates.status !== undefined) {
    fields.push('status = ?');
    values.push(updates.status);
  }

  if (fields.length === 0) return;

  fields.push("updated_at = datetime('now')");
  values.push(id);

  db.prepare(`UPDATE payment_sessions SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

export function deleteShop(shop: string): void {
  const db = getDb();
  db.prepare('DELETE FROM shops WHERE shop = ?').run(shop);
}
