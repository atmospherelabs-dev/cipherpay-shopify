import { NextRequest, NextResponse } from 'next/server';
import { getShop, updateShopConfig } from '@/lib/db';

function sanitizeSecret(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;

  const sanitized = value
    .trim()
    .replace(/[\s\u2028\u2029]+/g, '');

  return sanitized || undefined;
}

function sanitizeUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;

  const sanitized = value.trim().replace(/\/+$/, '');
  return sanitized || undefined;
}

export async function GET(req: NextRequest) {
  const shop = req.nextUrl.searchParams.get('shop');
  if (!shop) {
    return NextResponse.json({ error: 'Missing shop' }, { status: 400 });
  }

  const shopData = await getShop(shop);
  if (!shopData) {
    return NextResponse.json({ error: 'Shop not found' }, { status: 404 });
  }

  const host = process.env.HOST || req.nextUrl.origin;

  return NextResponse.json({
    shop: shopData.shop,
    cipherpay_api_key: shopData.cipherpay_api_key ? '••••••' : null,
    cipherpay_api_url: shopData.cipherpay_api_url,
    cipherpay_webhook_secret: shopData.cipherpay_webhook_secret ? '••••••' : null,
    payment_url: host,
    webhook_url: `${host}/api/webhook/cipherpay`,
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { shop, cipherpay_api_key, cipherpay_api_url, cipherpay_webhook_secret } = body;

  if (!shop) {
    return NextResponse.json({ error: 'Missing shop' }, { status: 400 });
  }

  const shopData = await getShop(shop);
  if (!shopData) {
    return NextResponse.json({ error: 'Shop not found. Install the app first.' }, { status: 404 });
  }

  await updateShopConfig(shop, {
    cipherpay_api_key: sanitizeSecret(cipherpay_api_key),
    cipherpay_api_url: sanitizeUrl(cipherpay_api_url),
    cipherpay_webhook_secret: sanitizeSecret(cipherpay_webhook_secret),
  });

  return NextResponse.json({ ok: true });
}
