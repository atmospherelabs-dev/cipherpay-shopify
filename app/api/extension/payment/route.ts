import { NextRequest, NextResponse } from 'next/server';
import { getShop, getPaymentSessionByOrderId } from '@/lib/db';

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

function normalizeOrderId(id: string): string {
  return String(id).replace(/gid:\/\/shopify\/\w+\//g, '');
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const shop = body.shop;
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

    const existing = await getPaymentSessionByOrderId(shop, order_id);
    console.log('extension/payment: session lookup', { shop, order_id, found: Boolean(existing), invoiceId: existing?.cipherpay_invoice_id });
    if (existing?.cipherpay_invoice_id) {
      const checkoutDomain = shopData.cipherpay_api_url.includes('testnet')
        ? 'https://testnet.cipherpay.app'
        : 'https://cipherpay.app';
      console.log('extension/payment: returning existing session', { invoiceId: existing.cipherpay_invoice_id });
      return NextResponse.json(
        {
          payment_url: `${checkoutDomain}/pay/${existing.cipherpay_invoice_id}?theme=dark`,
          invoice_id: existing.cipherpay_invoice_id,
          status: existing.status,
        },
        { headers: corsHeaders() }
      );
    }

    // No session found yet — the webhook may still be processing.
    // Don't create a new invoice here to avoid duplicates.
    console.log('extension/payment: no session found, webhook may not have fired yet', { shop, order_id });
    return NextResponse.json(
      { pending: true },
      { status: 200, headers: corsHeaders() }
    );
  } catch (err) {
    console.error('Extension payment error:', err);
    return NextResponse.json(
      { error: 'Internal error' },
      { status: 500, headers: corsHeaders() }
    );
  }
}
