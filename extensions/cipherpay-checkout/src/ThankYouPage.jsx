/** @jsxImportSource preact */
import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";

const API_BASE = "https://connect.cipherpay.app";
const LOGO_URL = "https://cipherpay.app/logo-mark.png";
const ZEC_KEYWORDS = /zcash|zec|cipherpay/i;

function normalizeId(id) {
  if (!id) return null;
  return String(id).replace(/gid:\/\/shopify\/\w+\//g, "");
}

function getOrderId() {
  try {
    const oc = shopify.orderConfirmation;
    const id = oc?.value?.order?.id ?? oc?.current?.order?.id;
    if (id) return normalizeId(id);
  } catch (_) {}
  try {
    const o = shopify.order;
    const id = o?.value?.id ?? o?.current?.id;
    if (id) return normalizeId(id);
  } catch (_) {}
  return null;
}

function getShop() {
  try { return shopify.shop.myshopifyDomain; } catch (_) { return null; }
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
  render(<CipherPayThankYou />, document.body);
}

function CipherPayThankYou() {
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

  const orderId = getOrderId();
  const shop = getShop();

  if (!orderId || !shop) return null;
  if (!isZcashPayment()) return null;



  return (
    <s-stack padding="base" border="base" borderRadius="base" gap="base">
      <s-stack direction="inline" gap="small" alignItems="center">
        <s-box inlineSize="24px" blockSize="24px" minInlineSize="24px">
          <s-image
            src={LOGO_URL}
            accessibilityLabel="CipherPay"
            fit="contain"
          />
        </s-box>
        {error && <s-text>{error}</s-text>}
        <s-heading>Complete Your Payment</s-heading>
      </s-stack>
      <s-text>
        Your order is awaiting payment. Pay securely with Zcash (ZEC) via
        CipherPay.
      </s-text>
      <s-box padding="small none none none">
        <s-button variant="primary" href={paymentUrl || undefined}
          disabled={!paymentUrl} target="_blank">
          Pay with CipherPay
        </s-button>
      </s-box>
    </s-stack>
  );
}
