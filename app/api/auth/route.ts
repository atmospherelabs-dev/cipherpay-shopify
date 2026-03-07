import { NextRequest, NextResponse } from 'next/server';
import { buildInstallUrl } from '@/lib/shopify';

export async function GET(req: NextRequest) {
  const shop = req.nextUrl.searchParams.get('shop');

  if (!shop || !shop.match(/^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/)) {
    return NextResponse.json({ error: 'Invalid shop parameter' }, { status: 400 });
  }

  const installUrl = buildInstallUrl(shop);
  return NextResponse.redirect(installUrl);
}
