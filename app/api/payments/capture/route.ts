import { NextRequest, NextResponse } from 'next/server';
import { getShop } from '@/lib/db';
import { captureSessionResolve, captureSessionReject } from '@/lib/shopify-payments';

interface CaptureSessionRequest {
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

    const body: CaptureSessionRequest = await req.json();
    console.log('payments/capture: received', {
      shopDomain,
      captureId: body.id,
      paymentId: body.payment_id,
      amount: body.amount,
      currency: body.currency,
    });

    // ZEC payments are immediate (kind: "sale") so captures auto-resolve.
    // Funds were already received at payment time.
    try {
      await captureSessionResolve(shopDomain, shopData.access_token, body.gid);
      console.log('payments/capture: resolved', { shopDomain, captureId: body.id });
    } catch (err) {
      console.error('payments/capture: resolve failed, rejecting', err);
      await captureSessionReject(
        shopDomain,
        shopData.access_token,
        body.gid,
        'Capture failed. ZEC payment may not have been received.'
      );
    }

    return NextResponse.json({});
  } catch (err) {
    console.error('payments/capture: error', err);
    return NextResponse.json({ error: 'Capture processing failed' }, { status: 500 });
  }
}
