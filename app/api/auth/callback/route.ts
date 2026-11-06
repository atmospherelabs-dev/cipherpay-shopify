import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { verifyHmac, exchangeCodeForToken, registerWebhooks } from '@/lib/shopify';
import {
  deleteShopifyOAuthState,
  getShopifyAppCredentials,
  getShopifyOAuthState,
  saveShop,
} from '@/lib/db';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function installErrorPage(title: string, body: string): NextResponse {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CipherPay install error</title></head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0a0a0a;color:#ccc;font:14px/1.6 ui-monospace,Menlo,monospace;padding:16px">
<main style="max-width:560px;border:1px solid #333;border-radius:8px;padding:28px">
<h1 style="font-size:16px;color:#f87171;margin:0 0 12px">${escapeHtml(title)}</h1>
<p style="margin:0 0 16px">${escapeHtml(body)}</p>
<a href="https://www.cipherpay.app/en/dashboard" style="color:#22d3ee">Open CipherPay dashboard →</a>
</main></body></html>`;
  return new NextResponse(html, { status: 403, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

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
  if (oauthState && oauthState.shop !== shop) {
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
    if (clientId) {
      // Almost always a Client Secret copied from a different Shopify app.
      return installErrorPage(
        'Client Secret does not match this app',
        `Shopify signed this install with app ${clientId}, but the Client Secret saved in CipherPay belongs to a different app. ` +
          'In the Shopify Dev Dashboard, open the app with this Client ID, copy its Client Secret from Settings, ' +
          'then run Shopify setup again in your CipherPay dashboard (Settings → Integrations → Shopify) and reinstall.'
      );
    }
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
    const redirectUrl = `${host}/settings?shop=${encodeURIComponent(shop)}&session_token=${sessionToken}`;

    const response = NextResponse.redirect(redirectUrl);
    response.cookies.delete('shopify_oauth_state');
    await deleteShopifyOAuthState(storedState);
    return response;
  } catch (err) {
    console.error('OAuth callback error:', err);
    return NextResponse.json({ error: 'Installation failed' }, { status: 500 });
  }
}
