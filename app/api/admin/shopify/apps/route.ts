import { NextRequest, NextResponse } from 'next/server';
import { saveShopifyAppCredentials } from '@/lib/db';

function normalizeShop(shop: string): string {
  let normalized = shop.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  if (!normalized.includes('.')) {
    normalized = `${normalized}.myshopify.com`;
  }
  return normalized;
}

function isValidShop(shop: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/.test(shop);
}

function isValidClientId(clientId: string): boolean {
  return /^[a-zA-Z0-9_-]{8,128}$/.test(clientId);
}

export async function POST(req: NextRequest) {
  const expectedToken = process.env.SHOPIFY_SETUP_ADMIN_TOKEN;
  const providedToken = req.headers.get('x-admin-token');

  if (!expectedToken || providedToken !== expectedToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null) as {
    client_id?: string;
    client_secret?: string;
    shop_domain?: string;
  } | null;

  const clientId = body?.client_id?.trim();
  const clientSecret = body?.client_secret?.trim();
  const shopDomain = body?.shop_domain ? normalizeShop(body.shop_domain) : null;

  if (!clientId || !isValidClientId(clientId)) {
    return NextResponse.json({ error: 'Invalid client_id' }, { status: 400 });
  }

  if (!clientSecret || clientSecret.length < 16) {
    return NextResponse.json({ error: 'Invalid client_secret' }, { status: 400 });
  }

  if (shopDomain && !isValidShop(shopDomain)) {
    return NextResponse.json({ error: 'Invalid shop_domain' }, { status: 400 });
  }

  await saveShopifyAppCredentials(clientId, clientSecret, shopDomain);
  const host = process.env.HOST || 'https://connect.cipherpay.app';

  return NextResponse.json({
    ok: true,
    client_id: clientId,
    shop_domain: shopDomain,
    app_url: `${host}/api/auth/tenant/${clientId}`,
    redirect_url: `${host}/api/auth/callback`,
  });
}
