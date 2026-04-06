import { NextRequest, NextResponse } from 'next/server';
import { getShop, getPaymentSessionByOrderId, createPaymentSession, acquireOrderLock } from '@/lib/db';
import { createInvoice } from '@/lib/cipherpay';
import { shopifyAdminApi } from '@/lib/shopify';
import { verifyShopifySessionToken } from '@/lib/verify-session-token';
import crypto from 'crypto';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

function normalizeOrderId(id: string): string {
  return String(id).replace(/gid:\/\/shopify\/\w+\//g, '');
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Try JWT from header or body; fall back to shop domain validation
    const authHeader = req.headers.get('Authorization');
    const sessionToken = (authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null)
      || body.session_token
      || null;

    let verifiedShop: string | null = null;
    if (sessionToken) {
      try {
        verifiedShop = await verifyShopifySessionToken(sessionToken);
      } catch (err) {
        console.warn('extension/payment: JWT failed, trying shop fallback', err);
      }
    }

    if (!verifiedShop && body.shop) {
      const fallbackShop = await getShop(body.shop);
      if (fallbackShop?.cipherpay_api_key) {
        verifiedShop = body.shop;
      }
    }

    if (!verifiedShop) {
      console.warn('extension/payment: no valid authentication');
      return NextResponse.json(
        { error: 'Authorization required' },
        { status: 401, headers: corsHeaders() }
      );
    }
    const shop = verifiedShop;
    const order_id = normalizeOrderId(body.order_id || '');
    console.log('extension/payment: request received', { shop, order_id });

    if (!shop || !order_id) {
      console.log('extension/payment: missing params', { shop, order_id });
      return NextResponse.json(
        { error: 'Missing shop or order_id' },
        { status: 400, headers: corsHeaders() }
      );
    }

    const shopData = await getShop(shop);
    if (!shopData || !shopData.cipherpay_api_key) {
      console.log('extension/payment: shop not configured', { shop });
      return NextResponse.json(
        { error: 'Shop not configured' },
        { status: 404, headers: corsHeaders() }
      );
    }

    const checkoutDomain = shopData.cipherpay_api_url.includes('testnet')
      ? 'https://testnet.cipherpay.app'
      : 'https://cipherpay.app';

    const existing = await getPaymentSessionByOrderId(shop, order_id);
    console.log('extension/payment: session lookup', { shop, order_id, found: Boolean(existing), invoiceId: existing?.cipherpay_invoice_id });

    // For existing sessions (polling), return immediately without hitting Shopify API
    if (existing?.cipherpay_invoice_id) {
      const payUrl = `${checkoutDomain}/pay/${existing.cipherpay_invoice_id}?theme=dark`;
      return NextResponse.json(
        {
          payment_url: payUrl,
          invoice_id: existing.cipherpay_invoice_id,
          status: existing.status,
        },
        { headers: corsHeaders() }
      );
    }

    // No session yet — fetch order from Shopify to create invoice
    const lockAcquired = await acquireOrderLock(shop, order_id);
    if (!lockAcquired) {
      console.log('extension/payment: lock held by another process, retrying', { shop, order_id });
      return NextResponse.json({ pending: true }, { status: 200, headers: corsHeaders() });
    }

    let orderData: { total_price: string; currency: string; gateway?: string; payment_gateway_names?: string[]; line_items?: Array<{ title: string }>; order_status_url?: string } | null = null;
    try {
      const res = await shopifyAdminApi(shop, shopData.access_token, `orders/${order_id}.json`);
      orderData = res.order;
    } catch (err) {
      console.warn('extension/payment: could not fetch order', { shop, order_id, err });
    }

    if (!orderData) {
      console.error('extension/payment: no order data available', { shop, order_id });
      return NextResponse.json({ pending: true }, { status: 200, headers: corsHeaders() });
    }

    const orderStatusUrl = orderData.order_status_url || `https://${shop}`;
    console.log('extension/payment: redirect info', { shop, order_id, orderStatusUrl });

    const gateway = (orderData.gateway || '').toLowerCase();
    const paymentMethod = (orderData.payment_gateway_names || []).join(' ').toLowerCase();
    const isZcash = gateway.includes('zcash') || gateway.includes('zec') || gateway.includes('cipherpay') ||
      paymentMethod.includes('zcash') || paymentMethod.includes('zec') || paymentMethod.includes('cipherpay');

    if (!isZcash) {
      console.log('extension/payment: not a Zcash payment, skipping', { shop, order_id, gateway, paymentMethod });
      return NextResponse.json({ skip: true }, { status: 200, headers: corsHeaders() });
    }

    const amount = parseFloat(orderData.total_price);
    const currency = orderData.currency || 'USD';
    const productName = orderData.line_items?.length
      ? orderData.line_items.map((i) => i.title).join(', ').substring(0, 200)
      : `Order #${order_id}`;

    const invoice = await createInvoice(shopData.cipherpay_api_url, shopData.cipherpay_api_key, {
      product_name: productName,
      amount,
      currency,
    });

    const sessionId = crypto.randomUUID();
    await createPaymentSession({
      id: sessionId,
      shop,
      shopify_order_id: order_id,
      cipherpay_invoice_id: invoice.id,
      amount: amount.toString(),
      currency,
    });

    const returnParam = orderStatusUrl ? `&return_url=${encodeURIComponent(orderStatusUrl)}` : '';
    const payUrl = `${checkoutDomain}/pay/${invoice.id}?theme=dark${returnParam}`;
    console.log('extension/payment: invoice created', { shop, order_id, invoiceId: invoice.id, orderStatusUrl: orderStatusUrl || '(empty)' });

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
