import { NextRequest, NextResponse } from 'next/server';
import { verifyHmac, exchangeCodeForToken } from '@/lib/shopify';
import { saveShop } from '@/lib/db';

export async function GET(req: NextRequest) {
  const params = Object.fromEntries(req.nextUrl.searchParams.entries());
  const { shop, code } = params;

  if (!shop || !code) {
    return NextResponse.json({ error: 'Missing shop or code' }, { status: 400 });
  }

  if (!verifyHmac(params)) {
    return NextResponse.json({ error: 'HMAC verification failed' }, { status: 403 });
  }

  try {
    const accessToken = await exchangeCodeForToken(shop, code);
    await saveShop(shop, accessToken);

    const host = process.env.HOST || req.nextUrl.origin;
    return NextResponse.redirect(`${host}/settings?shop=${encodeURIComponent(shop)}`);
  } catch (err) {
    console.error('OAuth callback error:', err);
    return NextResponse.json({ error: 'Installation failed' }, { status: 500 });
  }
}
