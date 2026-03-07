import { NextRequest, NextResponse } from 'next/server';
import { verifyHmac, exchangeCodeForToken, registerWebhooks } from '@/lib/shopify';
import { saveShop } from '@/lib/db';

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

  if (!verifyHmac(params)) {
    return NextResponse.json({ error: 'HMAC verification failed' }, { status: 403 });
  }

  try {
    const accessToken = await exchangeCodeForToken(shop, code);
    await saveShop(shop, accessToken);

    try {
      await registerWebhooks(shop, accessToken);
    } catch (err) {
      console.error('Webhook registration failed (non-blocking):', err);
    }

    const host = process.env.HOST || req.nextUrl.origin;
    const redirectUrl = `${host}/settings?shop=${encodeURIComponent(shop)}`;

    const response = NextResponse.redirect(redirectUrl);
    response.cookies.delete('shopify_oauth_state');
    return response;
  } catch (err) {
    console.error('OAuth callback error:', err);
    return NextResponse.json({ error: 'Installation failed' }, { status: 500 });
  }
}
