import { saveFulfillment } from '@/lib/db';
import { processFulfillment } from '@/lib/fulfillment';
import { NextRequest, NextResponse } from 'next/server';
import { verifyCipherPayWebhook } from '@/lib/cipherpay';
import {
  getPaymentSessionByInvoiceId,
  updatePaymentSession,
  getShop,
  getShopifyPaymentSessionByInvoiceId,
  updateShopifyPaymentSession,
} from '@/lib/db';
import { markOrderAsPaid } from '@/lib/shopify';
import { paymentSessionResolve, paymentSessionReject } from '@/lib/shopify-payments';

export async function POST(req: NextRequest) {
  try {
    const body = await req.text();
    const signature = req.headers.get('x-cipherpay-signature') || '';
    const timestamp = req.headers.get('x-cipherpay-timestamp') || '';

    const payload = JSON.parse(body);
    const invoiceId = payload.invoice_id || payload.id;
    const event = payload.event || payload.status;

    if (!invoiceId) {
      return NextResponse.json({ error: 'Missing invoice_id' }, { status: 400 });
    }

    // Try legacy payment session first (manual payment method flow)
    const session = await getPaymentSessionByInvoiceId(invoiceId);

    // Determine which shop to use for webhook verification
    const shopDomain = session?.shop;
    let shopData = shopDomain ? await getShop(shopDomain) : null;

    // If no legacy session, check for a Payments Extension session
    if (!session) {
      const spSession = await getShopifyPaymentSessionByInvoiceId(invoiceId);
      if (spSession) {
        shopData = await getShop(spSession.shop);
      }

      if (!spSession && !shopData) {
        console.warn(`No payment session found for invoice ${invoiceId}`);
        return NextResponse.json({ error: 'Payment mapping unavailable' }, { status: 503 });
      }
    }

    if (!shopData) {
      return NextResponse.json({ error: 'Shop not found' }, { status: 404 });
    }

    if (!shopData.cipherpay_webhook_secret) {
      console.error('CipherPay webhook rejected: no webhook secret configured for', shopData.shop);
      return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 403 });
    }

    if (!signature) {
      console.error('CipherPay webhook rejected: missing signature header');
      return NextResponse.json({ error: 'Missing signature' }, { status: 401 });
    }

    const valid = verifyCipherPayWebhook(body, signature, timestamp, shopData.cipherpay_webhook_secret);
    if (!valid) {
      console.error('CipherPay webhook signature verification failed');
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    const tsMs = new Date(timestamp).getTime();
    if (isNaN(tsMs) || Math.abs(Date.now() - tsMs) > 5 * 60 * 1000) {
      console.error('CipherPay webhook rejected: timestamp outside 5-minute window');
      return NextResponse.json({ error: 'Timestamp expired' }, { status: 401 });
    }

    if (!['confirmed','detected','underpaid','expired','cancelled','refunded'].includes(event)) {
      return NextResponse.json({ error: 'Unsupported event' }, { status: 400 });
    }
    const jobId = await saveFulfillment(invoiceId, event, shopData.shop);
    await processFulfillment(jobId);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('CipherPay webhook error:', err);
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}
