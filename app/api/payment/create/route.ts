import { NextRequest, NextResponse } from 'next/server';
import { getShop, createPaymentSession, getPaymentSessionByOrderId, acquireOrderLock } from '@/lib/db';
import { createInvoice } from '@/lib/cipherpay';
import { shopifyAdminApi } from '@/lib/shopify';
import crypto from 'crypto';

const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET!;

function verifyHmac(query: Record<string, string>): boolean {
  const { hmac, ...rest } = query;
  if (!hmac) return false;

  const sorted = Object.keys(rest).sort().map(k => `${k}=${rest[k]}`).join('&');
  const computed = crypto
    .createHmac('sha256', SHOPIFY_API_SECRET)
    .update(sorted)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(computed));
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  try {
    const hmac = req.nextUrl.searchParams.get('hmac')
      || req.headers.get('x-shopify-hmac');

    if (!hmac) {
      return NextResponse.json({ error: 'Unauthorized: HMAC required' }, { status: 401 });
    }

    const params = Object.fromEntries(req.nextUrl.searchParams.entries());
    if (!verifyHmac(params)) {
      return NextResponse.json({ error: 'Unauthorized: invalid HMAC' }, { status: 401 });
    }

    const body = await req.json();
    const { shop, order_id } = body;

    if (!shop || !order_id) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    if (!shop.match(/^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/)) {
      return NextResponse.json({ error: 'Invalid shop domain' }, { status: 400 });
    }

    const shopData = await getShop(shop);
    if (!shopData || !shopData.cipherpay_api_key) {
      return NextResponse.json({ error: 'Shop not configured' }, { status: 400 });
    }

    const existing = await getPaymentSessionByOrderId(shop, String(order_id));
    if (existing?.cipherpay_invoice_id) {
      const checkoutDomain = shopData.cipherpay_api_url.includes('testnet')
        ? 'https://testnet.cipherpay.app'
        : 'https://cipherpay.app';
      return NextResponse.json({
        payment_url: `${checkoutDomain}/pay/${existing.cipherpay_invoice_id}?theme=dark`,
        invoice_id: existing.cipherpay_invoice_id,
        session_id: existing.id,
      });
    }

    const lockAcquired = await acquireOrderLock(shop, String(order_id));
    if (!lockAcquired) {
      return NextResponse.json({ pending: true }, { status: 200 });
    }

    let orderData: { total_price: string; currency: string; line_items?: Array<{ title: string }>; order_number?: string };
    try {
      const res = await shopifyAdminApi(shop, shopData.access_token, `orders/${order_id}.json`);
      orderData = res.order;
    } catch {
      return NextResponse.json({ error: 'Failed to fetch order from Shopify' }, { status: 502 });
    }

    const amount = parseFloat(orderData.total_price);
    const currency = orderData.currency || 'USD';
    const productName = orderData.line_items?.length
      ? orderData.line_items.map((i) => i.title).join(', ').substring(0, 200)
      : `Order #${orderData.order_number || order_id}`;

    const returnUrl = `https://${shop}/admin/orders/${order_id}`;

    const invoice = await createInvoice(
      shopData.cipherpay_api_url,
      shopData.cipherpay_api_key,
      {
        product_name: productName,
        amount,
        currency,
      }
    );

    const sessionId = crypto.randomUUID();
    await createPaymentSession({
      id: sessionId,
      shop,
      shopify_order_id: String(order_id),
      cipherpay_invoice_id: invoice.id,
      amount: amount.toString(),
      currency,
    });

    const checkoutDomain = shopData.cipherpay_api_url.includes('testnet')
      ? 'https://testnet.cipherpay.app'
      : 'https://cipherpay.app';

    const payUrl = `${checkoutDomain}/pay/${invoice.id}?theme=dark&return_url=${encodeURIComponent(returnUrl)}`;

    return NextResponse.json({
      payment_url: payUrl,
      invoice_id: invoice.id,
      session_id: sessionId,
    });
  } catch (err) {
    console.error('Payment creation error:', err);
    return NextResponse.json({ error: 'Failed to create payment' }, { status: 500 });
  }
}
