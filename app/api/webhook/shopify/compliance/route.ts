import { NextRequest, NextResponse } from 'next/server';
import { verifyWebhookHmac } from '@/lib/shopify';
import { deleteShop } from '@/lib/db';

/**
 * Shopify mandatory compliance webhooks.
 * Required for all apps distributed via the App Store.
 *
 * Topics handled:
 *   - customers/data_request  → Acknowledge (we store no customer PII)
 *   - customers/redact        → Acknowledge (we store no customer PII)
 *   - shop/redact             → Delete all shop data from Redis
 *
 * See: https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance
 */
export async function POST(req: NextRequest) {
  const rawBody = Buffer.from(await req.arrayBuffer());
  const hmac = req.headers.get('x-shopify-hmac-sha256') || '';
  const topic = req.headers.get('x-shopify-topic') || '';
  const shopDomain = req.headers.get('x-shopify-shop-domain') || '';

  if (!verifyWebhookHmac(rawBody, hmac)) {
    return NextResponse.json({ error: 'Invalid HMAC' }, { status: 401 });
  }

  switch (topic) {
    case 'customers/data_request': {
      // CipherPay stores no customer PII (names, emails, addresses, etc.)
      // Only order IDs, amounts, and invoice references are kept (24h TTL).
      // Respond with acknowledgment — no data to export.
      console.log(`Compliance: customers/data_request from ${shopDomain} — no PII stored`);
      return NextResponse.json({ ok: true });
    }

    case 'customers/redact': {
      // No customer PII to delete. Payment sessions contain only order IDs
      // and amounts, and expire automatically after 24 hours.
      console.log(`Compliance: customers/redact from ${shopDomain} — no PII to delete`);
      return NextResponse.json({ ok: true });
    }

    case 'shop/redact': {
      // Merchant requested full data deletion after uninstalling.
      // Delete shop config (access token, API keys) from Redis.
      await deleteShop(shopDomain);
      console.log(`Compliance: shop/redact from ${shopDomain} — shop data deleted`);
      return NextResponse.json({ ok: true });
    }

    default: {
      console.warn(`Compliance: unknown topic "${topic}" from ${shopDomain}`);
      return NextResponse.json({ ok: true });
    }
  }
}
