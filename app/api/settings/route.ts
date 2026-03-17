import { NextRequest, NextResponse } from 'next/server';
import { getShop, updateShopConfig } from '@/lib/db';
import crypto from 'crypto';

const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET!;

function sanitizeSecret(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const sanitized = value.trim().replace(/[\s\u2028\u2029]+/g, '');
  return sanitized || undefined;
}

function sanitizeUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const sanitized = value.trim().replace(/\/+$/, '');
  return sanitized || undefined;
}

function verifyHmac(query: Record<string, string>): boolean {
  const { hmac, ...rest } = query;
  if (!hmac) return false;

  const sorted = Object.keys(rest).sort().map(k => `${k}=${rest[k]}`).join('&');
  const computed = crypto
    .createHmac('sha256', SHOPIFY_API_SECRET)
    .update(sorted)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(computed));
  } catch {
    return false;
  }
}

async function authenticateShop(req: NextRequest): Promise<boolean> {
  const hmac = req.nextUrl.searchParams.get('hmac')
    || req.headers.get('x-shopify-hmac');

  if (hmac) {
    const params = Object.fromEntries(req.nextUrl.searchParams.entries());
    const valid = verifyHmac(params);
    console.log('[settings auth] HMAC verification:', valid);
    return valid;
  }

  const sessionToken = req.nextUrl.searchParams.get('session_token');
  const shop = req.nextUrl.searchParams.get('shop');
  console.log('[settings auth] No HMAC. session_token:', sessionToken ? 'present' : 'missing', 'shop:', shop);

  if (sessionToken && shop) {
    const { verifySessionToken } = await import('@/lib/db');
    const valid = await verifySessionToken(shop, sessionToken);
    console.log('[settings auth] Session token verification:', valid, 'token:', sessionToken.slice(0, 8) + '...');
    return valid;
  }

  return false;
}

export async function GET(req: NextRequest) {
  const shop = req.nextUrl.searchParams.get('shop');
  if (!shop) {
    return NextResponse.json({ error: 'Missing shop' }, { status: 400 });
  }

  if (!shop.match(/^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/)) {
    return NextResponse.json({ error: 'Invalid shop domain' }, { status: 400 });
  }

  const authenticated = await authenticateShop(req);
  if (!authenticated) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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

  if (!shop.match(/^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/)) {
    return NextResponse.json({ error: 'Invalid shop domain' }, { status: 400 });
  }

  const authenticated = await authenticateShop(req);
  if (!authenticated) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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
