import { render } from "preact";
import { useState, useEffect } from "preact/hooks";

const API_BASE = "https://shopify.cipherpay.app";

export default function () {
  render(<CipherPayCheckout />, document.body);
}

function CipherPayCheckout() {
  const [paymentUrl, setPaymentUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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
          if (res.status === 404) {
            setLoading(false);
            return;
          }
          throw new Error(`Request failed: ${res.status}`);
        }

        const data = await res.json();
        if (!cancelled && data.payment_url) {
          setPaymentUrl(data.payment_url);
        }
      } catch (err) {
        if (!cancelled) {
          console.error("CipherPay extension error:", err);
          setError("Unable to load payment details");
        }
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
          <s-text>Loading payment details...</s-text>
        </s-stack>
      </s-box>
    );
  }

  if (!paymentUrl) return null;
  if (error) return null;

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
