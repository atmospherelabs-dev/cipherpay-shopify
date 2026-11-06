/** @jsxImportSource preact */
import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";

const API_BASE = "https://connect.cipherpay.app";
const LOGO_URL = "https://cipherpay.app/logo-mark.png";
const POLL_MS = 2000;
// Stop asking after about a minute; the order status page retries later.
const MAX_ATTEMPTS = 30;

function normalizeId(id) {
  if (!id) return null;
  const value = String(id).replace(/gid:\/\/shopify\/\w+\//g, "");
  // The checkout editor previews a placeholder order with no real ID.
  return /^[1-9]\d*$/.test(value) ? value : null;
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

function inEditor() {
  try { return Boolean(shopify.extension?.editor); } catch (_) { return false; }
}

export default function () {
  render(<CipherPayThankYou />, document.body);
}

function CipherPayThankYou() {
  const editor = inEditor();
  const orderId = editor ? null : getOrderId();
  const shop = getShop();

  const [paymentUrl, setPaymentUrl] = useState(null);
  useEffect(() => {
    if (!orderId || !shop) return undefined;
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
          body: JSON.stringify({ shop, order_id: orderId,
            checkout_token: shopify.checkoutToken?.value ?? shopify.checkoutToken?.current }),
        });
        if (cancelled) return;
        // Auth/config errors will not fix themselves; transient ones may.
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
        // A blocked or failed request lands here, e.g. when network access
        // is not enabled for the app's checkout extensions.
        console.warn('CipherPay: payment request failed', e?.message ?? e);
        retry();
      }
    }
    load();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [orderId, shop]);

  // Show merchants where the button will appear while they edit checkout.
  if (editor) {
    return (
      <s-stack padding="base" border="base" borderRadius="base" gap="small">
        <s-heading>CipherPay Checkout</s-heading>
        <s-text>
          The "Pay with CipherPay" button appears here for orders paid with
          Zcash (ZEC). Other orders don't show this block.
        </s-text>
      </s-stack>
    );
  }
  // Only an authorized server response can confirm an unpaid Zcash order.
  if (!orderId || !shop || !paymentUrl) return null;
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
        <s-heading>Complete Your Payment</s-heading>
      </s-stack>
      <s-text>
        Your order is awaiting payment. Pay securely with Zcash (ZEC) via
        CipherPay.
      </s-text>
      <s-box padding="small none none none">
        <s-button variant="primary" href={paymentUrl} target="_blank">
          Pay with CipherPay
        </s-button>
      </s-box>
    </s-stack>
  );
}
