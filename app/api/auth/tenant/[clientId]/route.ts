import { NextRequest, NextResponse } from 'next/server';

function isValidClientId(clientId: string): boolean {
  return /^[a-zA-Z0-9_-]{8,128}$/.test(clientId);
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const { clientId } = await params;
  const shop = req.nextUrl.searchParams.get('shop');

  if (!isValidClientId(clientId)) {
    return NextResponse.json({ error: 'Invalid client_id parameter' }, { status: 400 });
  }

  const authUrl = new URL('/api/auth', req.nextUrl.origin);
  authUrl.searchParams.set('client_id', clientId);
  if (shop) {
    authUrl.searchParams.set('shop', shop);
  }

  return NextResponse.redirect(authUrl);
}
