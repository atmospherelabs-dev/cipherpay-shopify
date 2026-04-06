/** @jsxImportSource preact */
import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useState, useEffect } from "preact/hooks";

const API_BASE = "https://connect.cipherpay.app";
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
  const [status, setStatus] = useState("pending");
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
    const MAX_ATTEMPTS = 10;
    const RETRY_MS = 2000;

    async function doFetch() {
      let token = null;
      try { token = await shopify.idToken(); } catch (_) {}

      const headers = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const res = await fetch(`${API_BASE}/api/extension/payment`, {
        method: "POST",
        headers,
        body: JSON.stringify({ shop, order_id: orderId, session_token: token }),
      });
      return res.json();
    }

    async function fetchPayment() {
      try {
        const data = await doFetch();
        if (cancelled) return;

        if (data.payment_url) {
          setPaymentUrl(data.payment_url);
          setStatus(data.status || "pending");
          setLoading(false);
        } else if (data.skip) {
          setSkip(true);
          setLoading(false);
        } else if (attempts < MAX_ATTEMPTS) {
          attempts++;
          setTimeout(fetchPayment, RETRY_MS);
        } else {
          setError("Payment link unavailable. Please check your order email.");
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled && attempts < MAX_ATTEMPTS) {
          attempts++;
          setTimeout(fetchPayment, RETRY_MS);
        } else if (!cancelled) {
          setError("Could not load payment. Please check your order email.");
          setLoading(false);
        }
      }
    }

    // Poll for status updates after initial load (payment may complete while page is open)
    let pollTimer = null;
    async function pollStatus() {
      try {
        const data = await doFetch();
        if (cancelled) return;
        if (data.status === "confirmed" || data.status === "detected") {
          setStatus(data.status);
        }
      } catch (_) {}
      if (!cancelled) pollTimer = setTimeout(pollStatus, 10000);
    }

    fetchPayment().then(() => {
      if (!cancelled) pollTimer = setTimeout(pollStatus, 10000);
    });

    return () => { cancelled = true; clearTimeout(pollTimer); };
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

  const isPaid = status === "confirmed" || status === "detected";

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
        <s-heading>{isPaid ? "Payment Received" : "Complete Your Payment"}</s-heading>
      </s-stack>
      {isPaid ? (
        <s-text>
          Your Zcash (ZEC) payment has been received. Thank you!
        </s-text>
      ) : (
        <s-stack gap="small">
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
      )}
    </s-stack>
  );
}
