import { NextRequest, NextResponse } from 'next/server';
import { getShopifyPaymentSession } from '@/lib/db';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Customer return endpoint after paying on CipherPay checkout.
 * Waits for payment confirmation, then redirects back to Shopify.
 *
 * If the payment session is already resolved, redirects immediately.
 * If still pending, serves a lightweight HTML page that auto-refreshes
 * until the payment is confirmed (or times out).
 */
export async function GET(req: NextRequest) {
  const sid = req.nextUrl.searchParams.get('sid');

  if (!sid) {
    return new NextResponse('Missing session ID', { status: 400 });
  }

  const session = await getShopifyPaymentSession(sid);

  if (!session) {
    return new NextResponse('Session not found', { status: 404 });
  }

  if (session.status === 'resolved') {
    return NextResponse.redirect(session.cancel_url);
  }

  if (session.status === 'rejected') {
    return NextResponse.redirect(session.cancel_url);
  }

  // Payment still pending — show a waiting page that auto-refreshes
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="refresh" content="3">
  <title>Completing your order — CipherPay</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'JetBrains Mono', 'SF Mono', monospace;
      background: #09090b;
      color: #e4e4e7;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
    }
    .container {
      text-align: center;
      max-width: 400px;
      padding: 48px 24px;
    }
    .spinner {
      width: 32px;
      height: 32px;
      border: 2px solid #27272a;
      border-top-color: #00D4FF;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin: 0 auto 24px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    h1 {
      font-size: 16px;
      font-weight: 600;
      margin-bottom: 8px;
    }
    p {
      font-size: 12px;
      color: #71717a;
      line-height: 1.6;
    }
    .accent { color: #00D4FF; }
    a {
      color: #71717a;
      text-decoration: none;
      font-size: 11px;
      margin-top: 32px;
      display: inline-block;
    }
    a:hover { color: #a1a1aa; }
  </style>
</head>
<body>
  <div class="container">
    <div class="spinner"></div>
    <h1>Completing your order</h1>
    <p>
      Confirming your <span class="accent">Zcash</span> payment.
      You'll be redirected back to the store momentarily.
    </p>
    <a href="${escapeHtml(session.cancel_url)}">Return to checkout</a>
  </div>
</body>
</html>`;

  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
