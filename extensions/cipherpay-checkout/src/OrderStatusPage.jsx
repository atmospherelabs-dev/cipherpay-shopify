import { render } from "preact";
import { useState, useEffect } from "preact/hooks";

const API_BASE = "https://shopify.cipherpay.app";

export default function () {
  render(<CipherPayOrderStatus />, document.body);
}

function CipherPayOrderStatus() {
  const [paymentUrl, setPaymentUrl] = useState(null);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);

  const order = shopify.order;
  const shop = shopify.shop;

  useEffect(() => {
    if (!order?.id || !shop?.myshopifyDomain) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function fetchPayment() {
      try {
        const res = await fetch(`${API_BASE}/api/extension/payment`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            shop: shop.myshopifyDomain,
            order_id: order.id.replace("gid://shopify/Order/", ""),
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
  }, [order?.id, shop?.myshopifyDomain]);

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
          onClick={() => {
            window.open(paymentUrl, "_blank");
          }}
        >
          Pay with Zcash (ZEC)
        </s-button>
      </s-stack>
    </s-box>
  );
}
