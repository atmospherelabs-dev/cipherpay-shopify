import { NextRequest, NextResponse } from 'next/server';
import { getShop } from '@/lib/db';
import { refundSessionResolve, refundSessionReject } from '@/lib/shopify-payments';

interface RefundSessionRequest {
  id: string;
  gid: string;
  payment_id: string;
  amount: string;
  currency: string;
  test: boolean;
  proposed_at: string;
}

export async function POST(req: NextRequest) {
  try {
    const shopDomain = req.headers.get('shopify-shop-domain');
    if (!shopDomain) {
      return NextResponse.json({ error: 'Missing shop domain' }, { status: 400 });
    }

    const shopData = await getShop(shopDomain);
    if (!shopData) {
      return NextResponse.json({ error: 'Shop not found' }, { status: 404 });
    }

    const body: RefundSessionRequest = await req.json();
    console.log('payments/refund: received', {
      shopDomain,
      refundId: body.id,
      paymentId: body.payment_id,
      amount: body.amount,
      currency: body.currency,
      test: body.test,
    });

    // ZEC refunds are resolved immediately on Shopify's side.
    // The actual ZEC send-back is handled through CipherPay's dashboard.
    // Merchants manage on-chain refunds manually via their wallet.
    try {
      await refundSessionResolve(shopDomain, shopData.access_token, body.gid);
      console.log('payments/refund: resolved', { shopDomain, refundId: body.id });
    } catch (err) {
      console.error('payments/refund: resolve failed, rejecting', err);
      await refundSessionReject(
        shopDomain,
        shopData.access_token,
        body.gid,
        'Refund processing failed. Please contact support.'
      );
    }

    return NextResponse.json({});
  } catch (err) {
    console.error('payments/refund: error', err);
    return NextResponse.json({ error: 'Refund processing failed' }, { status: 500 });
  }
}
