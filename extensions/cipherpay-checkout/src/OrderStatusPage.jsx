/** @jsxImportSource preact */
import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";

const API_BASE = "https://connect.cipherpay.app";
const POLL_MS = 2000;
const MAX_ATTEMPTS = 30;

function normalizeOrderId(orderId) {
  if (!orderId) return null;
  const value = String(orderId).replace(/gid:\/\/shopify\/\w+\//g, "");
  // Editor previews use a placeholder order with no real ID.
  return /^[1-9]\d*$/.test(value) ? value : null;
}

function inEditor() {
  try { return Boolean(shopify.extension?.editor); } catch (_) { return false; }
}

export default function () {
  render(<CipherPayOrderStatus />, document.body);
}

function CipherPayOrderStatus() {
  const editor = inEditor();
  const orderId = editor ? null : normalizeOrderId(shopify.order?.value?.id ?? shopify.order?.current?.id);
  const shopDomain = shopify.shop?.myshopifyDomain;

  const [paymentUrl, setPaymentUrl] = useState(null);
  useEffect(() => {
    if (!orderId || !shopDomain) return undefined;
    let cancelled = false;
    let timer;
    let attempts = 0;
    const retry = () => {
      if (!cancelled && ++attempts < MAX_ATTEMPTS) timer = setTimeout(load, POLL_MS);
    };
    async function load() {
      try {
        const token = await shopify.sessionToken.get();
        const res = await fetch(`${API_BASE}/api/extension/payment`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ shop: shopDomain, order_id: orderId,
            checkout_token: shopify.checkoutToken?.value ?? shopify.checkoutToken?.current }),
        });
        if (cancelled) return;
        if (res.status === 401 || res.status === 404) {
          console.warn(`CipherPay: payment request rejected (${res.status})`);
          return;
        }
        if (!res.ok) { retry(); return; }
        const data = await res.json();
        if (cancelled || data.skip) return;
        if (data.payment_url) { setPaymentUrl(data.payment_url); return; }
        if (data.pending) retry();
      } catch (e) {
        console.warn('CipherPay: payment request failed', e?.message ?? e);
        retry();
      }
    }
    load();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [orderId, shopDomain]);

  if (editor) {
    return (
      <s-box border="base" padding="base" borderRadius="base">
        <s-stack gap="small">
          <s-heading>CipherPay Checkout</s-heading>
          <s-text>
            Customers with an unpaid Zcash (ZEC) order see a payment button
            here.
          </s-text>
        </s-stack>
      </s-box>
    );
  }
  // Payment options on the page are not proof of the order's payment method.
  if (!orderId || !shopDomain || !paymentUrl) return null;
  return (
    <s-box border="base" padding="base" borderRadius="base">
      <s-stack gap="base">
        <s-heading>Zcash Payment</s-heading>
        <s-text>
          Click below to complete or check the status of your Zcash (ZEC)
          payment.
        </s-text>
        <s-button variant="primary" href={paymentUrl} target="_blank">
          Pay with Zcash (ZEC)
        </s-button>
      </s-stack>
    </s-box>
  );
}
