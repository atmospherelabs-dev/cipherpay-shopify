import { getFulfillment, completeFulfillment, acquireFulfillmentLock, releaseFulfillmentLock,
  getShop, getPaymentSessionByInvoiceId, updatePaymentSession,
  getShopifyPaymentSessionByInvoiceId, updateShopifyPaymentSession } from './db';
import { markOrderAsPaid } from './shopify';
import { paymentSessionResolve, paymentSessionReject } from './shopify-payments';

export async function processFulfillment(id: string): Promise<void> {
  const job = await getFulfillment(id);
  if (!job) return;
  const lock = await acquireFulfillmentLock(job.invoiceId);
  if (!lock) throw new Error('Fulfillment already processing');
  try {
    const shop = await getShop(job.shop);
    if (!shop?.access_token) throw new Error('Shop unavailable');
    const session = await getPaymentSessionByInvoiceId(job.invoiceId);
    if (session && session.shop !== job.shop) throw new Error('Fulfillment shop mismatch');
    if (session && session.status !== 'confirmed' && session.status !== 'refunded') {
      if (job.event === 'confirmed') {
        if (!session.shopify_order_id) throw new Error('Order mapping missing');
        await markOrderAsPaid(job.shop, shop.access_token, session.shopify_order_id);
        await updatePaymentSession(session.id, { status: 'confirmed' });
      } else if (['detected','expired','cancelled'].includes(job.event)) {
        await updatePaymentSession(session.id, { status: job.event });
      }
    }
    const sp = await getShopifyPaymentSessionByInvoiceId(job.invoiceId);
    if (sp && sp.shop !== job.shop) throw new Error('Payment session shop mismatch');
    if (sp?.status === 'pending') {
      if (job.event === 'confirmed') {
        await paymentSessionResolve(job.shop, shop.access_token, sp.gid);
        await updateShopifyPaymentSession(sp.id, { status: 'resolved' });
      } else if (job.event === 'expired' || job.event === 'cancelled') {
        await paymentSessionReject(job.shop, shop.access_token, sp.gid, 'Payment expired or cancelled');
        await updateShopifyPaymentSession(sp.id, { status: 'rejected' });
      }
    }
    if (!session && !sp) throw new Error('Payment mapping missing');
    await completeFulfillment(id);
  } finally { await releaseFulfillmentLock(job.invoiceId, lock); }
}
