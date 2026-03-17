import { NextRequest, NextResponse } from 'next/server';
import { getShop } from '@/lib/db';
import { voidSessionResolve, voidSessionReject } from '@/lib/shopify-payments';

interface VoidSessionRequest {
  id: string;
  gid: string;
  payment_id: string;
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

    const body: VoidSessionRequest = await req.json();
    console.log('payments/void: received', {
      shopDomain,
      voidId: body.id,
      paymentId: body.payment_id,
    });

    // Void requests acknowledge cancellation of an unpaid session.
    // If ZEC was already sent on-chain, this can't truly void it —
    // a refund would be needed instead. We resolve optimistically.
    try {
      await voidSessionResolve(shopDomain, shopData.access_token, body.gid);
      console.log('payments/void: resolved', { shopDomain, voidId: body.id });
    } catch (err) {
      console.error('payments/void: resolve failed, rejecting', err);
      await voidSessionReject(
        shopDomain,
        shopData.access_token,
        body.gid,
        'Void failed. Payment may have already been processed on-chain.'
      );
    }

    return NextResponse.json({});
  } catch (err) {
    console.error('payments/void: error', err);
    return NextResponse.json({ error: 'Void processing failed' }, { status: 500 });
  }
}
