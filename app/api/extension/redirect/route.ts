import { NextResponse } from 'next/server';
export async function GET() {
  return NextResponse.json({ error: 'Open payment from the CipherPay checkout extension. This legacy link has expired.' },
    { status: 410, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
}
