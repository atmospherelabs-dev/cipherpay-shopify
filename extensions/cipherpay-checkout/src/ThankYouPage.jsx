/** @jsxImportSource preact */
import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useState, useCallback } from "preact/hooks";

const API_BASE = "https://shopify.cipherpay.app";

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
  const [state, setState] = useState("idle");
  const [paymentUrl, setPaymentUrl] = useState(null);
  const [error, setError] = useState(null);

  const handleClick = useCallback(async () => {
    const orderId = getOrderId();
    const shop = getShop();

    if (!orderId || !shop) {
      setError("Could not detect order. Please contact the store.");
      return;
    }

    setState("loading");
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/api/extension/payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shop, order_id: orderId }),
      });
      const data = await res.json();

      if (data.payment_url) {
        setPaymentUrl(data.payment_url);
        setState("ready");
      } else if (data.skip) {
        setState("skip");
      } else {
        setError("Payment not ready yet. Try again in a few seconds.");
        setState("idle");
      }
    } catch (err) {
      setError("Error loading payment. Please try again.");
      setState("idle");
    }
  }, []);

  if (state === "skip") return null;

  if (state === "ready" && paymentUrl) {
    return (
      <s-box border="base" padding="base" borderRadius="base">
        <s-stack gap="base">
          <s-heading>Pay with Zcash (ZEC)</s-heading>
          <s-text>Your payment link is ready.</s-text>
          <s-button variant="primary" href={paymentUrl} target="_blank">
            Open Zcash Payment Page
          </s-button>
        </s-stack>
      </s-box>
    );
  }

  return (
    <s-box border="base" padding="base" borderRadius="base">
      <s-stack gap="base">
        <s-heading>Pay with Zcash (ZEC)</s-heading>
        <s-text>Click below to complete your payment with Zcash.</s-text>
        <s-button
          variant="primary"
          loading={state === "loading" || undefined}
          disabled={state === "loading" || undefined}
          onClick={handleClick}
        >
          Pay with Zcash (ZEC)
        </s-button>
        {error && <s-text appearance="warning">{error}</s-text>}
      </s-stack>
    </s-box>
  );
}
