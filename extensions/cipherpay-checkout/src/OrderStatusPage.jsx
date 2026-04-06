/** @jsxImportSource preact */
import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useState, useEffect } from "preact/hooks";

const API_BASE = "https://connect.cipherpay.app";

function normalizeOrderId(orderId) {
  if (!orderId) return null;
  return String(orderId).replace("gid://shopify/Order/", "");
}

export default function () {
  render(<CipherPayOrderStatus />, document.body);
}

function CipherPayOrderStatus() {
  const [paymentUrl, setPaymentUrl] = useState(null);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);

  const orderId = normalizeOrderId(shopify.order.value?.id);
  const shopDomain = shopify.shop.myshopifyDomain;

  useEffect(() => {
    if (!orderId || !shopDomain) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function fetchPayment() {
      try {
        const token = await shopify.idToken();
        const res = await fetch(`${API_BASE}/api/extension/payment`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`,
          },
          body: JSON.stringify({
            order_id: orderId,
            session_token: token,
          }),
        });

        if (!res.ok) {
          setLoading(false);
          return;
        }

        const data = await res.json();
        if (!cancelled) {
          if (data.payment_url) setPaymentUrl(data.payment_url);
          if (data.status) setStatus(data.status);
        }
      } catch (err) {
        console.error("CipherPay extension error:", err);
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
        </s-stack>
      </s-box>
    );
  }

  if (!paymentUrl) return null;

  if (status === "confirmed" || status === "detected") {
    return (
      <s-box border="base" padding="base" borderRadius="base">
        <s-stack gap="base">
          <s-heading>Zcash Payment Received</s-heading>
          <s-text>Your Zcash payment has been confirmed. Thank you!</s-text>
        </s-stack>
      </s-box>
    );
  }

  return (
    <s-box border="base" padding="base" borderRadius="base">
      <s-stack gap="base">
        <s-heading>Zcash Payment Pending</s-heading>
        <s-text>
          Your order is awaiting Zcash (ZEC) payment. Click below to complete
          your payment.
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
