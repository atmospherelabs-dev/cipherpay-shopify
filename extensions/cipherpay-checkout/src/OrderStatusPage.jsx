/** @jsxImportSource preact */
import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";

const API_BASE = "https://connect.cipherpay.app";
const ZEC_KEYWORDS = /zcash|zec|cipherpay/i;

function normalizeOrderId(orderId) {
  if (!orderId) return null;
  return String(orderId).replace("gid://shopify/Order/", "");
}

function isZcashPayment() {
  try {
    const sig = shopify.selectedPaymentOptions ?? shopify.payments?.selectedPaymentOptions;
    const options = sig?.value ?? sig?.current;
    if (!options || !Array.isArray(options)) return true; // fail open — server handles non-Zcash
    return options.some(
      (opt) =>
        opt.type === "manualPayment" ||
        (opt.handle && ZEC_KEYWORDS.test(opt.handle))
    );
  } catch (_) {
    return true; // fail open
  }
}

export default function () {
  render(<CipherPayOrderStatus />, document.body);
}

function CipherPayOrderStatus() {
  const [paymentUrl, setPaymentUrl] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const token = await shopify.sessionToken.get();
        const oc = shopify.orderConfirmation;
        const order = oc?.value?.order?.id ?? oc?.current?.order?.id ?? shopify.order?.value?.id;
        if (!order) return;
        const res = await fetch(`${API_BASE}/api/extension/payment`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ shop: shopify.shop.myshopifyDomain, order_id: order,
            checkout_token: shopify.checkoutToken?.value ?? shopify.checkoutToken?.current }),
        });
        if (!res.ok) throw new Error('Unable to prepare payment. Please refresh or contact the store.');
        const data = await res.json();
        if (!cancelled && data.payment_url) setPaymentUrl(data.payment_url);
        if (!cancelled && data.pending) timer = setTimeout(load, 2000);
      } catch (e) { if (!cancelled) setError(e.message); }
    }
    let timer;
    load();
    return () => { cancelled = true; clearTimeout(timer); };
  }, []);

  const orderId = normalizeOrderId(shopify.order.value?.id);
  const shopDomain = shopify.shop.myshopifyDomain;

  if (!orderId || !shopDomain) return null;
  if (!isZcashPayment()) return null;



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
