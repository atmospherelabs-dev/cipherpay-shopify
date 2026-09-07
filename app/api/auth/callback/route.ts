import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { setSettingsSession } from '@/lib/settings-session';
import { verifyHmac, exchangeCodeForToken, registerWebhooks } from '@/lib/shopify';
import {
  deleteShopifyOAuthState,
  getShopifyAppCredentials,
  getShopifyOAuthState,
  saveShop,
} from '@/lib/db';

export async function GET(req: NextRequest) {
  const params = Object.fromEntries(req.nextUrl.searchParams.entries());
  const { shop, code, state } = params;

  if (!shop || !code) {
    return NextResponse.json({ error: 'Missing shop or code' }, { status: 400 });
  }

  const storedState = req.cookies.get('shopify_oauth_state')?.value;
  if (!storedState || storedState !== state) {
    return NextResponse.json({ error: 'Invalid state parameter' }, { status: 403 });
  }

  const oauthState = await getShopifyOAuthState(storedState);
  if (!oauthState || oauthState.shop !== shop) {
    return NextResponse.json({ error: 'OAuth shop mismatch' }, { status: 403 });
  }

  const appCredentials = oauthState?.client_id
    ? await getShopifyAppCredentials(oauthState.client_id)
    : null;

  if (oauthState?.client_id && !appCredentials) {
    return NextResponse.json({ error: 'Unknown Shopify app credentials' }, { status: 403 });
  }

  const clientSecret = appCredentials?.client_secret;
  const clientId = appCredentials?.client_id;

  if (!verifyHmac(params, clientSecret)) {
    return NextResponse.json({ error: 'HMAC verification failed' }, { status: 403 });
  }

  try {
    const accessToken = await exchangeCodeForToken(shop, code, { clientId, clientSecret });
    await saveShop(shop, accessToken, clientId);

    try {
      await registerWebhooks(shop, accessToken);
    } catch (err) {
      console.error('Webhook registration failed (non-blocking):', err);
    }

    const { saveSessionToken } = await import('@/lib/db');
    const sessionToken = crypto.randomUUID();
    await saveSessionToken(shop, sessionToken);

    const host = process.env.HOST || req.nextUrl.origin;
    const redirectUrl = `${host}/settings?shop=${encodeURIComponent(shop)}`;

    const response = NextResponse.redirect(redirectUrl);
    setSettingsSession(response, shop, sessionToken);
    response.cookies.delete('shopify_oauth_state');
    await deleteShopifyOAuthState(storedState);
    return response;
  } catch (err) {
    console.error('OAuth callback error:', err);
    return NextResponse.json({ error: 'Installation failed' }, { status: 500 });
  }
}
