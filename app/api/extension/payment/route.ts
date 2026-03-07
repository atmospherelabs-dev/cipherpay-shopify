import { NextRequest, NextResponse } from 'next/server';
import { getShop, getPaymentSessionByOrderId, createPaymentSession } from '@/lib/db';
import { createInvoice } from '@/lib/cipherpay';
import { shopifyAdminApi } from '@/lib/shopify';
import crypto from 'crypto';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

export async function POST(req: NextRequest) {
  try {
    const { shop, order_id } = await req.json();

    if (!shop || !order_id) {
      return NextResponse.json(
        { error: 'Missing shop or order_id' },
        { status: 400, headers: corsHeaders() }
      );
    }

    const shopData = await getShop(shop);
    if (!shopData || !shopData.cipherpay_api_key) {
      return NextResponse.json(
        { error: 'Shop not configured' },
        { status: 404, headers: corsHeaders() }
      );
    }

    const existing = await getPaymentSessionByOrderId(shop, order_id);
    if (existing?.cipherpay_invoice_id) {
      const checkoutDomain = shopData.cipherpay_api_url.includes('testnet')
        ? 'https://testnet.cipherpay.app'
        : 'https://cipherpay.app';
      return NextResponse.json(
        {
          payment_url: `${checkoutDomain}/pay/${existing.cipherpay_invoice_id}?theme=dark`,
          invoice_id: existing.cipherpay_invoice_id,
          status: existing.status,
        },
        { headers: corsHeaders() }
      );
    }

    let order;
    try {
      const orderRes = await shopifyAdminApi(
        shop,
        shopData.access_token,
        `orders/${order_id}.json`
      );
      order = orderRes.order;
    } catch (err) {
      console.error(`Extension: failed to fetch order ${order_id}:`, err);
      return NextResponse.json(
        { error: 'Order not found' },
        { status: 404, headers: corsHeaders() }
      );
    }

    const gateway = (order.gateway || '').toLowerCase();
    const paymentMethod = (order.payment_gateway_names || []).join(' ').toLowerCase();
    const isZcash =
      gateway.includes('zcash') || gateway.includes('zec') || gateway.includes('cipherpay') ||
      paymentMethod.includes('zcash') || paymentMethod.includes('zec') || paymentMethod.includes('cipherpay');

    if (!isZcash) {
      return NextResponse.json(
        { skip: true },
        { status: 200, headers: corsHeaders() }
      );
    }

    const productName = order.line_items?.length > 0
      ? order.line_items.map((i: { title: string }) => i.title).join(', ').substring(0, 200)
      : `Order #${order.order_number || order.id}`;

    const amount = parseFloat(order.total_price);
    const currency = order.currency || 'USD';

    const invoice = await createInvoice(
      shopData.cipherpay_api_url,
      shopData.cipherpay_api_key,
      {
        product_name: productName,
        amount,
        currency,
        return_url: `https://${shop}/account/orders`,
        theme: 'dark',
      }
    );
    if (!invoice.id) {
      throw new Error('CipherPay invoice response missing id');
    }

    const sessionId = crypto.randomUUID();
    await createPaymentSession({
      id: sessionId,
      shop,
      shopify_order_id: order_id,
      cipherpay_invoice_id: invoice.id,
      amount: amount.toString(),
      currency,
    });

    const checkoutDomain = shopData.cipherpay_api_url.includes('testnet')
      ? 'https://testnet.cipherpay.app'
      : 'https://cipherpay.app';
    const payUrl = `${checkoutDomain}/pay/${invoice.id}?theme=dark`;

    try {
      await shopifyAdminApi(shop, shopData.access_token, `orders/${order.id}.json`, {
        method: 'PUT',
        body: {
          order: {
            id: order.id,
            tags: `cipherpay,invoice:${invoice.id}`,
          },
        },
      });
    } catch (err) {
      console.error('Extension: failed to tag order:', err);
    }

    console.log(`Extension: created invoice ${invoice.id} for order #${order.order_number} on ${shop}`);

    return NextResponse.json(
      { payment_url: payUrl, invoice_id: invoice.id, status: 'pending' },
      { headers: corsHeaders() }
    );
  } catch (err) {
    console.error('Extension payment error:', err);
    return NextResponse.json(
      { error: 'Internal error' },
      { status: 500, headers: corsHeaders() }
    );
  }
}
