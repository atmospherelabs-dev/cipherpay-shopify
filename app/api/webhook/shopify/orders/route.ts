import { NextRequest, NextResponse } from 'next/server';
import { verifyWebhookHmac, shopifyAdminApi } from '@/lib/shopify';
import { getShop, createPaymentSession, getPaymentSessionByOrderId, acquireOrderLock } from '@/lib/db';
import { createInvoice } from '@/lib/cipherpay';
import crypto from 'crypto';

function firstNonLatin1Char(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.charCodeAt(index);
    if (codePoint > 255) {
      return { index, codePoint };
    }
  }

  return null;
}

export async function POST(req: NextRequest) {
  const rawBody = Buffer.from(await req.arrayBuffer());
  const hmac = req.headers.get('x-shopify-hmac-sha256') || '';
  const shopDomain = req.headers.get('x-shopify-shop-domain') || '';
  console.log('orders/create webhook: received request', {
    shopDomain,
    bodyBytes: rawBody.length,
    hasHmac: Boolean(hmac),
  });

  if (!verifyWebhookHmac(rawBody, hmac)) {
    console.error('orders/create webhook: HMAC verification failed');
    return NextResponse.json({ error: 'Invalid HMAC' }, { status: 401 });
  }

  try {
    const body = rawBody.toString('utf8');
    const order = JSON.parse(body);
    console.log('orders/create webhook: parsed order', {
      shopDomain,
      orderId: order.id,
      orderNumber: order.order_number,
    });

    const gateway = (order.gateway || '').toLowerCase();
    const paymentMethod = (order.payment_gateway_names || []).join(' ').toLowerCase();
    const isZcash = gateway.includes('zcash') || gateway.includes('zec') || gateway.includes('cipherpay') ||
      paymentMethod.includes('zcash') || paymentMethod.includes('zec') || paymentMethod.includes('cipherpay');
    console.log('orders/create webhook: payment detection', {
      shopDomain,
      orderId: order.id,
      gateway,
      paymentMethod,
      isZcash,
    });

    if (!isZcash) {
      return NextResponse.json({ ok: true, skipped: 'not a Zcash payment' });
    }

    const shopData = await getShop(shopDomain);
    console.log('orders/create webhook: loaded shop config', {
      shopDomain,
      foundShop: Boolean(shopData),
      hasCipherPayKey: Boolean(shopData?.cipherpay_api_key),
    });
    if (!shopData || !shopData.cipherpay_api_key) {
      console.error(`orders/create: shop ${shopDomain} not configured`);
      return NextResponse.json({ error: 'Shop not configured' }, { status: 400 });
    }

    const existingSession = await getPaymentSessionByOrderId(shopDomain, order.id.toString());
    if (existingSession?.cipherpay_invoice_id) {
      console.log('orders/create webhook: session already exists, tagging order', {
        shopDomain, orderId: order.id, invoiceId: existingSession.cipherpay_invoice_id,
      });
      try {
        await shopifyAdminApi(shopDomain, shopData.access_token, `orders/${order.id}.json`, {
          method: 'PUT',
          body: { order: { id: order.id, tags: `cipherpay,${existingSession.cipherpay_invoice_id}` } },
        });
      } catch (err) {
        console.error('Failed to tag order (existing session):', err);
      }
      return NextResponse.json({ ok: true, invoice_id: existingSession.cipherpay_invoice_id, skipped: 'already exists' });
    }

    const lockAcquired = await acquireOrderLock(shopDomain, order.id.toString());
    if (!lockAcquired) {
      console.log('orders/create webhook: lock held by extension, will tag later via retry', { shopDomain, orderId: order.id });
      return NextResponse.json({ ok: true, skipped: 'lock held' });
    }

    const productName = order.line_items?.length > 0
      ? order.line_items.map((i: { title: string }) => i.title).join(', ').substring(0, 200)
      : `Order #${order.order_number || order.id}`;

    const amount = parseFloat(order.total_price);
    const currency = order.currency || 'USD';

    const invoiceParams = {
      product_name: productName,
      currency,
      amount,
    };
    console.log('orders/create webhook: creating invoice', {
      shopDomain,
      orderId: order.id,
      amount,
      currency,
      productNameLength: productName.length,
      productNameNonLatin1: firstNonLatin1Char(productName),
    });

    const invoice = await createInvoice(
      shopData.cipherpay_api_url,
      shopData.cipherpay_api_key,
      invoiceParams
    );
    if (!invoice.id) {
      throw new Error('CipherPay invoice response missing id');
    }
    console.log('orders/create webhook: invoice created', {
      shopDomain,
      orderId: order.id,
      invoiceId: invoice.id,
    });

    const sessionId = crypto.randomUUID();
    await createPaymentSession({
      id: sessionId,
      shop: shopDomain,
      shopify_order_id: order.id.toString(),
      cipherpay_invoice_id: invoice.id,
      amount: amount.toString(),
      currency,
    });
    console.log('orders/create webhook: payment session stored', {
      shopDomain,
      orderId: order.id,
      sessionId,
      invoiceId: invoice.id,
    });

    const checkoutDomain = shopData.cipherpay_api_url.includes('testnet')
      ? 'https://testnet.cipherpay.app'
      : 'https://cipherpay.app';
    const orderStatusUrl = order.order_status_url || '';
    const returnParam = orderStatusUrl ? `&return_url=${encodeURIComponent(orderStatusUrl)}` : '';
    const payUrl = `${checkoutDomain}/pay/${invoice.id}?theme=dark${returnParam}`;
    const orderNote = `Pay with Zcash: ${payUrl}`;
    console.log('orders/create webhook: updating Shopify order', {
      shopDomain,
      orderId: order.id,
      noteLength: orderNote.length,
      noteNonLatin1: firstNonLatin1Char(orderNote),
    });

    try {
      await shopifyAdminApi(shopDomain, shopData.access_token, `orders/${order.id}.json`, {
        method: 'PUT',
        body: {
          order: {
            id: order.id,
            note: orderNote,
            tags: `cipherpay,${invoice.id}`,
          },
        },
      });
      console.log('orders/create webhook: Shopify order updated', {
        shopDomain,
        orderId: order.id,
        invoiceId: invoice.id,
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
