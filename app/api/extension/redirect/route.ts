import { NextRequest, NextResponse } from 'next/server';
import { getShop, getPaymentSessionByOrderId, createPaymentSession, acquireOrderLock } from '@/lib/db';
import { createInvoice } from '@/lib/cipherpay';
import { shopifyAdminApi } from '@/lib/shopify';
import crypto from 'crypto';

export async function GET(req: NextRequest) {
  const shop = req.nextUrl.searchParams.get('shop');
  const orderId = req.nextUrl.searchParams.get('order_id')?.replace(/gid:\/\/shopify\/\w+\//g, '');

  if (!shop || !orderId) {
    return NextResponse.redirect(new URL(`https://${shop || 'shopify.com'}`));
  }

  try {
    const shopData = await getShop(shop);
    if (!shopData?.cipherpay_api_key) {
      return NextResponse.redirect(new URL(`https://${shop}`));
    }

    const checkoutDomain = shopData.cipherpay_api_url.includes('testnet')
      ? 'https://testnet.cipherpay.app'
      : 'https://cipherpay.app';

    const existing = await getPaymentSessionByOrderId(shop, orderId);
    if (existing?.cipherpay_invoice_id) {
      const orderStatusUrl = existing.order_status_url || `https://${shop}`;
      const returnParam = `&return_url=${encodeURIComponent(orderStatusUrl)}`;
      return NextResponse.redirect(
        new URL(`${checkoutDomain}/pay/${existing.cipherpay_invoice_id}?theme=dark${returnParam}`)
      );
    }

    const lockAcquired = await acquireOrderLock(shop, orderId);
    if (!lockAcquired) {
      // Another process is creating the invoice — retry after short delay
      const retryUrl = new URL(req.url);
      return new NextResponse(
        `<html><head><meta http-equiv="refresh" content="2;url=${retryUrl}"></head><body style="background:#0a0a0a;color:#aaa;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh"><p>Preparing payment...</p></body></html>`,
        { status: 200, headers: { 'Content-Type': 'text/html' } }
      );
    }

    let orderData: {
      total_price: string;
      currency: string;
      gateway?: string;
      payment_gateway_names?: string[];
      line_items?: Array<{ title: string }>;
      order_status_url?: string;
    } | null = null;

    try {
      const res = await shopifyAdminApi(shop, shopData.access_token, `orders/${orderId}.json`);
      orderData = res.order;
    } catch (err) {
      console.warn('extension/redirect: could not fetch order', { shop, orderId, err });
    }

    if (!orderData) {
      return NextResponse.redirect(new URL(`https://${shop}`));
    }

    const gateway = (orderData.gateway || '').toLowerCase();
    const paymentMethod = (orderData.payment_gateway_names || []).join(' ').toLowerCase();
    const isZcash = gateway.includes('zcash') || gateway.includes('zec') || gateway.includes('cipherpay') ||
      paymentMethod.includes('zcash') || paymentMethod.includes('zec') || paymentMethod.includes('cipherpay');

    if (!isZcash) {
      const fallback = orderData.order_status_url || `https://${shop}`;
      return NextResponse.redirect(new URL(fallback));
    }

    const amount = parseFloat(orderData.total_price);
    const currency = orderData.currency || 'USD';
    const productName = orderData.line_items?.length
      ? orderData.line_items.map((i) => i.title).join(', ').substring(0, 200)
      : `Order #${orderId}`;

    const invoice = await createInvoice(shopData.cipherpay_api_url, shopData.cipherpay_api_key, {
      product_name: productName,
      amount,
      currency,
    });

    const orderStatusUrl = orderData.order_status_url || `https://${shop}`;
    const sessionId = crypto.randomUUID();
    await createPaymentSession({
      id: sessionId,
      shop,
      shopify_order_id: orderId,
      cipherpay_invoice_id: invoice.id,
      amount: amount.toString(),
      currency,
    });

    const returnParam = `&return_url=${encodeURIComponent(orderStatusUrl)}`;
    return NextResponse.redirect(
      new URL(`${checkoutDomain}/pay/${invoice.id}?theme=dark${returnParam}`)
    );
  } catch (err) {
    console.error('Extension redirect error:', err);
    return NextResponse.redirect(new URL(`https://${shop}`));
  }
}
