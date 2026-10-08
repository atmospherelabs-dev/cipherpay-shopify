/** @jsxImportSource preact */
import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";

const API_BASE = "https://connect.cipherpay.app";

function normalizeOrderId(orderId) {
  if (!orderId) return null;
  return String(orderId).replace("gid://shopify/Order/", "");
}

export default function () {
  render(<CipherPayOrderStatus />, document.body);
}

function CipherPayOrderStatus() {
  const orderId = normalizeOrderId(shopify.order?.value?.id ?? shopify.order?.current?.id);
  const shopDomain = shopify.shop?.myshopifyDomain;

  const [paymentUrl, setPaymentUrl] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        if (!orderId || !shopDomain) return;
        const token = await shopify.sessionToken.get();
        const res = await fetch(`${API_BASE}/api/extension/payment`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ shop: shopDomain, order_id: orderId,
            checkout_token: shopify.checkoutToken?.value ?? shopify.checkoutToken?.current }),
        });
        if (!res.ok) throw new Error('Unable to prepare payment. Please refresh or contact the store.');
        const data = await res.json();
        if (cancelled) return;
        if (data.skip) { setPaymentUrl(null); return; }
        if (data.payment_url) setPaymentUrl(data.payment_url);
        if (data.pending) timer = setTimeout(load, 2000);
      } catch (e) { if (!cancelled) setError(e.message); }
    }
    let timer;
    load();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [orderId, shopDomain]);

  if (!orderId || !shopDomain) return null;
  // Payment options on the page are not proof of the order's payment method.
  if (!paymentUrl) return null;
  return (
    <s-box border="base" padding="base" borderRadius="base">
      <s-stack gap="base">
        {error && <s-text>{error}</s-text>}
        <s-heading>Zcash Payment</s-heading>
        <s-text>
          Click below to complete or check the status of your Zcash (ZEC)
          payment.
        </s-text>
        <s-button
          variant="primary"
          href={paymentUrl || undefined}
          disabled={!paymentUrl}
          target="_blank"
        >
          Pay with Zcash (ZEC)
        </s-button>
      </s-stack>
    </s-box>
  );
}
