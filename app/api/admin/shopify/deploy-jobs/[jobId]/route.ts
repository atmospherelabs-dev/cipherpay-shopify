import { NextRequest, NextResponse } from 'next/server';
import { getShopifyDeployStatus } from '@/lib/db';

function isValidJobId(jobId: string): boolean {
  return /^[a-f0-9-]{36}$/i.test(jobId);
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const expectedToken = process.env.SHOPIFY_SETUP_ADMIN_TOKEN;
  const providedToken = req.headers.get('x-admin-token');

  if (!expectedToken || providedToken !== expectedToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { jobId } = await params;
  if (!isValidJobId(jobId)) {
    return NextResponse.json({ error: 'Invalid job id' }, { status: 400 });
  }

  const status = await getShopifyDeployStatus(jobId);
  if (!status) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  return NextResponse.json(status);
}
