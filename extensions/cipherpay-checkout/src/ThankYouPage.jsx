import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useState, useEffect } from "preact/hooks";

const API_BASE = "https://shopify.cipherpay.app";

function normalizeOrderId(orderId) {
  if (!orderId) return null;
  return String(orderId).replace("gid://shopify/Order/", "");
}

function resolveOrderId() {
  try {
    const oc = shopify.orderConfirmation;
    if (oc) {
      const id = oc.value?.order?.id ?? oc.current?.order?.id;
      if (id) return normalizeOrderId(id);
    }
  } catch (_) {}

  try {
    const o = shopify.order;
    if (o) {
      const id = o.value?.id ?? o.current?.id ?? o.id;
      if (id) return normalizeOrderId(id);
    }
  } catch (_) {}

  return null;
}

function debugShopifyGlobal() {
  try {
    const keys = Object.keys(shopify || {});
    return keys.join(", ") || "(empty)";
  } catch (_) {
    return "(error reading shopify)";
  }
}

export default function () {
  render(<CipherPayCheckout />, document.body);
}

function CipherPayCheckout() {
  const [paymentUrl, setPaymentUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [debug, setDebug] = useState(null);

  const orderId = resolveOrderId();
  const shopDomain = shopify?.shop?.myshopifyDomain;

  useEffect(() => {
    if (!shopDomain) {
      setDebug(`No shopDomain. shopify keys: ${debugShopifyGlobal()}`);
      setLoading(false);
      return;
    }

    if (!orderId) {
      setDebug(`Waiting for orderId. shopify keys: ${debugShopifyGlobal()}`);
      const timeout = setTimeout(() => {
        const retryId = resolveOrderId();
        if (!retryId) {
          setDebug(`orderId not found after 10s. shopify keys: ${debugShopifyGlobal()}`);
          setLoading(false);
        }
      }, 10000);
      return () => clearTimeout(timeout);
    }

    let cancelled = false;
    setLoading(true);
    setDebug(null);

    async function fetchPayment() {
      try {
        const res = await fetch(`${API_BASE}/api/extension/payment`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            shop: shopDomain,
            order_id: orderId,
          }),
        });

        if (!res.ok) {
          const text = await res.text();
          if (!cancelled) setDebug(`API ${res.status}: ${text}`);
          return;
        }

        const data = await res.json();
        if (!cancelled && data.payment_url) {
          setPaymentUrl(data.payment_url);
        } else if (!cancelled && data.skip) {
          setDebug(null);
        } else if (!cancelled) {
          setDebug(`API returned no payment_url: ${JSON.stringify(data)}`);
        }
      } catch (err) {
        if (!cancelled) {
          console.error("CipherPay extension error:", err);
          setDebug(`Fetch error: ${err.message}`);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchPayment();
    return () => { cancelled = true; };
  }, [orderId, shopDomain]);

  if (loading) {
    return (
      <s-box padding="base" borderRadius="base">
        <s-stack blockAlignment="center" inlineAlignment="center" gap="base">
          <s-spinner />
          <s-text>Loading payment details...</s-text>
        </s-stack>
      </s-box>
    );
  }

  if (debug) {
    return (
      <s-box padding="base" borderRadius="base" border="base">
        <s-text size="small" appearance="subdued">CipherPay debug: {debug}</s-text>
      </s-box>
    );
  }

  if (!paymentUrl) return null;

  return (
    <s-box border="base" padding="base" borderRadius="base">
      <s-stack gap="base">
        <s-heading>Complete Your Payment</s-heading>
        <s-text>
          Your order requires a Zcash (ZEC) payment. Click the button below to
          open the secure payment page where you can scan a QR code or copy the
          payment address.
        </s-text>
        <s-button
          variant="primary"
          href={paymentUrl}
          target="_blank"
        >
          Pay with Zcash (ZEC)
        </s-button>
      </s-stack>
    </s-box>
  );
}
