import { NextRequest, NextResponse } from 'next/server';
import { verifyCipherPayWebhook } from '@/lib/cipherpay';
import { getPaymentSessionByInvoiceId, updatePaymentSession, getShop } from '@/lib/db';
import { markOrderAsPaid } from '@/lib/shopify';

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

    const session = await getPaymentSessionByInvoiceId(invoiceId);
    if (!session) {
      console.warn(`No payment session found for invoice ${invoiceId}`);
      return NextResponse.json({ ok: true });
    }

    const shopData = await getShop(session.shop);
    if (!shopData) {
      return NextResponse.json({ error: 'Shop not found' }, { status: 404 });
    }

    if (!shopData.cipherpay_webhook_secret) {
      console.error('CipherPay webhook rejected: no webhook secret configured for', session.shop);
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

    if (event === 'confirmed') {
      await updatePaymentSession(session.id, { status: 'confirmed' });

      if (session.shopify_order_id && shopData.access_token) {
        try {
          await markOrderAsPaid(session.shop, shopData.access_token, session.shopify_order_id);
          console.log(`Order ${session.shopify_order_id} marked as paid on ${session.shop}`);
        } catch (err) {
          console.error('Failed to mark order as paid on Shopify:', err);
        }
      }
    } else if (event === 'detected') {
      await updatePaymentSession(session.id, { status: 'detected' });
    } else if (event === 'expired' || event === 'cancelled') {
      await updatePaymentSession(session.id, { status: event });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('CipherPay webhook error:', err);
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}
