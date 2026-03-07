import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useState, useEffect } from "preact/hooks";

const API_BASE = "https://shopify.cipherpay.app";

function normalizeOrderId(orderId) {
  if (!orderId) return null;
  return String(orderId).replace("gid://shopify/Order/", "");
}

export default function () {
  render(<CipherPayCheckout />, document.body);
}

function CipherPayCheckout() {
  const [paymentUrl, setPaymentUrl] = useState(null);
  const [loading, setLoading] = useState(true);

  // .value triggers Preact signal subscription so the component
  // re-renders when order confirmation data becomes available
  const orderId = normalizeOrderId(shopify.orderConfirmation.value?.order?.id);
  const shopDomain = shopify.shop.myshopifyDomain;

  useEffect(() => {
    if (!shopDomain) {
      setLoading(false);
      return;
    }

    if (!orderId) {
      // Signal hasn't resolved yet -- keep spinner, auto-hide after 10s
      const timeout = setTimeout(() => setLoading(false), 10000);
      return () => clearTimeout(timeout);
    }

    let cancelled = false;
    setLoading(true);

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
          setLoading(false);
          return;
        }

        const data = await res.json();
        if (!cancelled && data.payment_url) {
          setPaymentUrl(data.payment_url);
        }
      } catch (err) {
        if (!cancelled) {
          console.error("CipherPay extension error:", err);
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
