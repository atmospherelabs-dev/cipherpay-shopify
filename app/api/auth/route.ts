import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { getShopifyAppCredentials, saveShopifyOAuthState } from '@/lib/db';
import { buildInstallUrl } from '@/lib/shopify';

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

export async function GET(req: NextRequest) {
  let shop = req.nextUrl.searchParams.get('shop');
  const clientId = req.nextUrl.searchParams.get('client_id');

  if (!shop) {
    return NextResponse.json({ error: 'Missing shop parameter' }, { status: 400 });
  }

  shop = normalizeShop(shop);

  if (!isValidShop(shop)) {
    return NextResponse.json({ error: 'Invalid shop parameter' }, { status: 400 });
  }

  if (clientId && !isValidClientId(clientId)) {
    return NextResponse.json({ error: 'Invalid client_id parameter' }, { status: 400 });
  }

  if (clientId) {
    const credentials = await getShopifyAppCredentials(clientId);
    if (!credentials) {
      return NextResponse.json({ error: 'Unknown Shopify app client_id' }, { status: 404 });
    }
    if (credentials.shop_domain && credentials.shop_domain !== shop) {
      return NextResponse.json({ error: 'client_id is not registered for this shop' }, { status: 403 });
    }
  }

  const state = crypto.randomBytes(16).toString('hex');
  await saveShopifyOAuthState(state, shop, clientId);

  const { url } = buildInstallUrl(shop, { clientId: clientId ?? undefined, state });

  const response = NextResponse.redirect(url);
  response.cookies.set('shopify_oauth_state', state, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 600,
    path: '/api/auth',
  });

  return response;
}
