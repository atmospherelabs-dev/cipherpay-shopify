import { NextRequest, NextResponse } from 'next/server';
import { getShop, updateShopConfig, verifySessionToken } from '@/lib/db';
import { validateCipherPayApiUrl } from '@/lib/cipherpay';
import { readSettingsSession } from '@/lib/settings-session';

async function principal(req: NextRequest): Promise<string | null> {
  const session = readSettingsSession(req);
  if (!session || !await verifySessionToken(session.shop, session.token)) return null;
  return session.shop;
}
function secret(value: unknown): string | undefined {
  if (typeof value !== 'string' || value === '••••••') return undefined;
  return value.trim().replace(/[\s\u2028\u2029]+/g, '') || undefined;
}
export async function GET(req: NextRequest) {
  const shop = await principal(req);
  if (!shop) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (req.nextUrl.searchParams.get('shop') !== shop) return NextResponse.json({ error: 'Shop mismatch' }, { status: 403 });
  const data = await getShop(shop);
  if (!data) return NextResponse.json({ error: 'Shop not found' }, { status: 404 });
  const host = process.env.HOST || req.nextUrl.origin;
  return NextResponse.json({ shop, cipherpay_api_key: data.cipherpay_api_key ? '••••••' : null,
    cipherpay_api_url: data.cipherpay_api_url,
    cipherpay_webhook_secret: data.cipherpay_webhook_secret ? '••••••' : null,
    payment_url: host, webhook_url: `${host}/api/webhook/cipherpay`,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
export async function POST(req: NextRequest) {
  // SameSite cookies plus an exact Origin check protect this credential-changing operation.
  if (req.headers.get('origin') !== new URL(process.env.HOST || req.nextUrl.origin).origin) {
    return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  }
  const shop = await principal(req);
  if (!shop) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  if (body.shop !== shop || req.nextUrl.searchParams.get('shop') !== shop) {
    return NextResponse.json({ error: 'Shop mismatch' }, { status: 403 });
  }
  if (!await getShop(shop)) return NextResponse.json({ error: 'Shop not found' }, { status: 404 });
  let apiUrl;
  try { apiUrl = body.cipherpay_api_url === undefined ? undefined : validateCipherPayApiUrl(body.cipherpay_api_url); }
  catch { return NextResponse.json({ error: 'Unsupported CipherPay API URL' }, { status: 400 }); }
  await updateShopConfig(shop, { cipherpay_api_key: secret(body.cipherpay_api_key),
    cipherpay_api_url: apiUrl, cipherpay_webhook_secret: secret(body.cipherpay_webhook_secret) });
  return NextResponse.json({ ok: true });
}
