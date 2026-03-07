import { NextRequest, NextResponse } from 'next/server';
import { buildInstallUrl } from '@/lib/shopify';

export async function GET(req: NextRequest) {
  let shop = req.nextUrl.searchParams.get('shop');

  if (!shop) {
    return NextResponse.json({ error: 'Missing shop parameter' }, { status: 400 });
  }

  shop = shop.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  if (!shop.includes('.')) {
    shop = `${shop}.myshopify.com`;
  }

  if (!shop.match(/^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/)) {
    return NextResponse.json({ error: 'Invalid shop parameter' }, { status: 400 });
  }

  const installUrl = buildInstallUrl(shop);
  return NextResponse.redirect(installUrl);
}
