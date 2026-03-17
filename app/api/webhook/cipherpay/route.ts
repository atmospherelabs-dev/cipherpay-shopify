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

async function resolveShopifyPaymentExtension(invoiceId: string, event: string): Promise<void> {
  const spSession = await getShopifyPaymentSessionByInvoiceId(invoiceId);
  if (!spSession || spSession.status !== 'pending') return;

  const shopData = await getShop(spSession.shop);
  if (!shopData?.access_token) return;

  if (event === 'confirmed') {
    await paymentSessionResolve(spSession.shop, shopData.access_token, spSession.gid);
    await updateShopifyPaymentSession(spSession.id, { status: 'resolved' });
    console.log(`Shopify payment session ${spSession.id} resolved for ${spSession.shop}`);
  } else if (event === 'expired' || event === 'cancelled') {
    await paymentSessionReject(
      spSession.shop,
      shopData.access_token,
      spSession.gid,
      event === 'expired' ? 'Payment expired' : 'Payment cancelled'
    );
    await updateShopifyPaymentSession(spSession.id, { status: 'rejected' });
    console.log(`Shopify payment session ${spSession.id} rejected (${event}) for ${spSession.shop}`);
  }
}

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
        return NextResponse.json({ ok: true });
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

    // Handle legacy manual payment method sessions
    if (session) {
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
    }

    // Handle Payments Extension sessions
    try {
      await resolveShopifyPaymentExtension(invoiceId, event);
    } catch (err) {
      console.error('Failed to resolve Shopify payment extension session:', err);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('CipherPay webhook error:', err);
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}
