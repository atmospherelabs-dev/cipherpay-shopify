/** @jsxImportSource preact */
import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useState, useEffect } from "preact/hooks";

const API_BASE = "https://shopify.cipherpay.app";
const LOGO_URL = "https://cipherpay.app/logo-mark.png";

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

export default function () {
  render(<CipherPayThankYou />, document.body);
}

function CipherPayThankYou() {
  const [paymentUrl, setPaymentUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [skip, setSkip] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const orderId = getOrderId();
    const shop = getShop();

    if (!orderId || !shop) {
      setLoading(false);
      setError("Could not detect order details.");
      return;
    }

    let cancelled = false;
    let attempts = 0;

    async function fetchPayment() {
      try {
        const res = await fetch(`${API_BASE}/api/extension/payment`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ shop, order_id: orderId }),
        });
        const data = await res.json();

        if (cancelled) return;

        if (data.payment_url) {
          setPaymentUrl(data.payment_url);
          setLoading(false);
        } else if (data.skip) {
          setSkip(true);
          setLoading(false);
        } else if (attempts < 3) {
          attempts++;
          setTimeout(fetchPayment, 2000);
        } else {
          setError("Payment link unavailable. Please check your email.");
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled && attempts < 3) {
          attempts++;
          setTimeout(fetchPayment, 2000);
        } else if (!cancelled) {
          setError("Could not load payment. Please check your email.");
          setLoading(false);
        }
      }
    }

    fetchPayment();
    return () => { cancelled = true; };
  }, []);

  if (skip) return null;

  if (loading) {
    return (
      <s-stack
        direction="inline"
        gap="small"
        alignItems="center"
        padding="base"
        border="base"
        borderRadius="base"
      >
        <s-spinner />
        <s-text appearance="subdued">Loading payment...</s-text>
      </s-stack>
    );
  }

  if (error) {
    return (
      <s-stack padding="base" border="base" borderRadius="base" gap="small">
        <s-text appearance="warning">{error}</s-text>
      </s-stack>
    );
  }

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
      <s-button variant="primary" href={paymentUrl} target="_blank">
        Pay with CipherPay
      </s-button>
    </s-stack>
  );
}
