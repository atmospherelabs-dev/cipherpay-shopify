import { NextRequest, NextResponse } from 'next/server';
import { verifyWebhookHmac, shopifyAdminApi } from '@/lib/shopify';
import { getShop, createPaymentSession } from '@/lib/db';
import { createInvoice } from '@/lib/cipherpay';
import crypto from 'crypto';

export async function POST(req: NextRequest) {
  const body = await req.text();
  const hmac = req.headers.get('x-shopify-hmac-sha256') || '';
  const shopDomain = req.headers.get('x-shopify-shop-domain') || '';

  if (!verifyWebhookHmac(body, hmac)) {
    console.error('orders/create webhook: HMAC verification failed');
    return NextResponse.json({ error: 'Invalid HMAC' }, { status: 401 });
  }

  try {
    const order = JSON.parse(body);

    const gateway = (order.gateway || '').toLowerCase();
    const paymentMethod = (order.payment_gateway_names || []).join(' ').toLowerCase();
    const isZcash = gateway.includes('zcash') || gateway.includes('zec') || gateway.includes('cipherpay') ||
      paymentMethod.includes('zcash') || paymentMethod.includes('zec') || paymentMethod.includes('cipherpay');

    if (!isZcash) {
      return NextResponse.json({ ok: true, skipped: 'not a Zcash payment' });
    }

    const shopData = await getShop(shopDomain);
    if (!shopData || !shopData.cipherpay_api_key) {
      console.error(`orders/create: shop ${shopDomain} not configured`);
      return NextResponse.json({ error: 'Shop not configured' }, { status: 400 });
    }

    const productName = order.line_items?.length > 0
      ? order.line_items.map((i: { title: string }) => i.title).join(', ').substring(0, 200)
      : `Order #${order.order_number || order.id}`;

    const amount = parseFloat(order.total_price);
    const currency = order.currency || 'USD';

    const invoiceParams = {
      product_name: productName,
      return_url: `https://${shopDomain}/account/orders`,
      theme: 'dark',
      currency,
      amount,
    };

    const invoice = await createInvoice(
      shopData.cipherpay_api_url,
      shopData.cipherpay_api_key,
      invoiceParams
    );

    const sessionId = crypto.randomUUID();
    await createPaymentSession({
      id: sessionId,
      shop: shopDomain,
      shopify_order_id: order.id.toString(),
      cipherpay_invoice_id: invoice.id,
      amount: amount.toString(),
      currency,
    });

    const checkoutDomain = shopData.cipherpay_api_url.includes('testnet')
      ? 'https://testnet.cipherpay.app'
      : 'https://cipherpay.app';
    const payUrl = `${checkoutDomain}/pay/${invoice.id}?theme=dark`;

    try {
      await shopifyAdminApi(shopDomain, shopData.access_token, `orders/${order.id}.json`, {
        method: 'PUT',
        body: {
          order: {
            id: order.id,
            note: `💰 Pay with Zcash: ${payUrl}`,
            tags: `cipherpay,invoice:${invoice.id}`,
          },
        },
      });
    } catch (err) {
      console.error('Failed to update order note:', err);
    }

    console.log(`Created CipherPay invoice ${invoice.id} for order #${order.order_number} on ${shopDomain}`);
    return NextResponse.json({ ok: true, invoice_id: invoice.id, payment_url: payUrl });
  } catch (err) {
    console.error('orders/create webhook error:', err);
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 });
  }
}
