import { NextRequest, NextResponse } from 'next/server';
import { getShop, saveShopifyPaymentSession, getShopifyPaymentSession } from '@/lib/db';
import { createInvoice } from '@/lib/cipherpay';
import { paymentSessionPending } from '@/lib/shopify-payments';

interface PaymentSessionRequest {
  id: string;
  gid: string;
  group: string;
  amount: string;
  currency: string;
  test: boolean;
  kind: string;
  customer: {
    email?: string;
    phone_number?: string;
    locale?: string;
    billing_address?: Record<string, string>;
    shipping_address?: Record<string, string>;
  };
  payment_method: {
    type: string;
    data: Record<string, unknown>;
  };
  proposed_at: string;
  cancel_url: string;
}

export async function POST(req: NextRequest) {
  try {
    const shopDomain = req.headers.get('shopify-shop-domain');

    if (!shopDomain) {
      console.error('payments/session: missing shopify-shop-domain header');
      return NextResponse.json({ error: 'Missing shop domain' }, { status: 400 });
    }

    const shopData = await getShop(shopDomain);
    if (!shopData || !shopData.cipherpay_api_key) {
      console.error('payments/session: shop not configured', { shopDomain });
      return NextResponse.json({ error: 'Shop not configured' }, { status: 400 });
    }

    const body: PaymentSessionRequest = await req.json();
    console.log('payments/session: received', {
      shopDomain,
      sessionId: body.id,
      amount: body.amount,
      currency: body.currency,
      kind: body.kind,
      test: body.test,
    });

    // Idempotency: if Shopify retries, return the same redirect_url
    const existing = await getShopifyPaymentSession(body.id);
    if (existing?.cipherpay_invoice_id) {
      console.log('payments/session: returning existing session (idempotent)', {
        sessionId: body.id,
        invoiceId: existing.cipherpay_invoice_id,
      });

      const checkoutDomain = shopData.cipherpay_api_url.includes('testnet')
        ? 'https://testnet.cipherpay.app'
        : 'https://cipherpay.app';
      const host = process.env.HOST || 'https://connect.cipherpay.app';
      const returnUrl = `${host}/api/payments/return?sid=${encodeURIComponent(body.id)}`;
      const redirectUrl = `${checkoutDomain}/pay/${existing.cipherpay_invoice_id}?theme=dark&return_url=${encodeURIComponent(returnUrl)}`;

      return NextResponse.json({ redirect_url: redirectUrl });
    }

    const amount = parseFloat(body.amount);
    const currency = body.currency || 'USD';

    const invoice = await createInvoice(
      shopData.cipherpay_api_url,
      shopData.cipherpay_api_key,
      {
        product_name: `Shopify order (${shopDomain})`,
        amount,
        currency,
      }
    );

    console.log('payments/session: invoice created', {
      shopDomain,
      sessionId: body.id,
      invoiceId: invoice.id,
    });

    await saveShopifyPaymentSession({
      id: body.id,
      gid: body.gid,
      group: body.group,
      shop: shopDomain,
      amount: body.amount,
      currency,
      test: body.test,
      kind: body.kind,
      cancel_url: body.cancel_url,
      cipherpay_invoice_id: invoice.id,
      status: 'pending',
    });

    // Tell Shopify the payment is pending (async crypto confirmation).
    // Pending expires when the CipherPay invoice expires.
    try {
      await paymentSessionPending(
        shopDomain,
        shopData.access_token,
        body.gid,
        invoice.expires_at
      );
    } catch (err) {
      console.error('payments/session: paymentSessionPending failed (non-blocking)', err);
    }

    const checkoutDomain = shopData.cipherpay_api_url.includes('testnet')
      ? 'https://testnet.cipherpay.app'
      : 'https://cipherpay.app';

    const host = process.env.HOST || 'https://connect.cipherpay.app';
    const returnUrl = `${host}/api/payments/return?sid=${encodeURIComponent(body.id)}`;
    const redirectUrl = `${checkoutDomain}/pay/${invoice.id}?theme=dark&return_url=${encodeURIComponent(returnUrl)}`;

    console.log('payments/session: redirecting customer', {
      shopDomain,
      sessionId: body.id,
      invoiceId: invoice.id,
    });

    return NextResponse.json({ redirect_url: redirectUrl });
  } catch (err) {
    console.error('payments/session: error', err);
    return NextResponse.json(
      { error: 'Failed to create payment session' },
      { status: 500 }
    );
  }
}
