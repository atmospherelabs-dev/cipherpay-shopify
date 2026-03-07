import { NextRequest, NextResponse } from 'next/server';
import { verifyWebhookHmac } from '@/lib/shopify';
import { deleteShop } from '@/lib/db';

export async function POST(req: NextRequest) {
  const body = await req.text();
  const hmac = req.headers.get('x-shopify-hmac-sha256') || '';
  const topic = req.headers.get('x-shopify-topic') || '';
  const shopDomain = req.headers.get('x-shopify-shop-domain') || '';

  if (!verifyWebhookHmac(body, hmac)) {
    return NextResponse.json({ error: 'Invalid HMAC' }, { status: 401 });
  }

  if (topic === 'app/uninstalled') {
    await deleteShop(shopDomain);
    console.log(`App uninstalled from ${shopDomain}, shop data deleted`);
  }

  return NextResponse.json({ ok: true });
}
