import { NextRequest, NextResponse } from 'next/server';
import { getShop, createPaymentSession, updatePaymentSession } from '@/lib/db';
import { createInvoice } from '@/lib/cipherpay';
import crypto from 'crypto';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { shop, order_id, order_number, amount, currency, line_items } = body;

    if (!shop || !order_id || !amount) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const shopData = await getShop(shop);
    if (!shopData || !shopData.cipherpay_api_key) {
      return NextResponse.json({ error: 'Shop not configured' }, { status: 400 });
    }

    const sessionId = crypto.randomUUID();
    const productName = line_items?.length > 0
      ? line_items.map((i: { title: string }) => i.title).join(', ')
      : `Order #${order_number || order_id}`;

    const returnUrl = `https://${shop}/admin/orders/${order_id}`;

    const parsedAmount = parseFloat(amount);
    const invoiceParams = {
      product_name: productName.substring(0, 200),
      return_url: returnUrl,
      theme: 'dark',
      currency: currency || 'EUR',
      amount: parsedAmount,
    };

    const invoice = await createInvoice(
      shopData.cipherpay_api_url,
      shopData.cipherpay_api_key,
      invoiceParams
    );

    await createPaymentSession({
      id: sessionId,
      shop,
      shopify_order_id: order_id,
      cipherpay_invoice_id: invoice.id,
      amount: amount.toString(),
      currency: currency || 'EUR',
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
