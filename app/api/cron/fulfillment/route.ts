import { NextRequest, NextResponse } from 'next/server';
import { pendingFulfillments } from '@/lib/db';
import { processFulfillment } from '@/lib/fulfillment';
export const maxDuration = 60;
export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET || req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) return new NextResponse(null, { status: 401 });
  const deadline = Date.now() + 40_000;
  let completed = 0, failed = 0;
  for (const id of await pendingFulfillments()) {
    if (Date.now() >= deadline) break;
    try { await processFulfillment(id); completed++; } catch { failed++; }
  }
  return NextResponse.json({ completed, failed });
}
