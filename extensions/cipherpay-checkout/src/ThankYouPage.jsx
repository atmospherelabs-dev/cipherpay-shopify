import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useState, useEffect } from "preact/hooks";

const API_BASE = "https://shopify.cipherpay.app";
const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 3000;

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
    return Object.keys(shopify || {}).join(", ") || "(empty)";
  } catch (_) {
    return "(error)";
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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
      setDebug(`No shopDomain. keys: ${debugShopifyGlobal()}`);
      setLoading(false);
      return;
    }

    if (!orderId) {
      setDebug(`Waiting for orderId. keys: ${debugShopifyGlobal()}`);
      const timeout = setTimeout(() => {
        if (!resolveOrderId()) {
          setDebug(`No orderId after 10s. keys: ${debugShopifyGlobal()}`);
          setLoading(false);
        }
      }, 10000);
      return () => clearTimeout(timeout);
    }

    let cancelled = false;
    setLoading(true);
    setDebug(null);

    async function fetchWithRetry() {
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        if (cancelled) return;

        try {
          const res = await fetch(`${API_BASE}/api/extension/payment`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              shop: shopDomain,
              order_id: orderId,
            }),
          });

          if (res.ok) {
            const data = await res.json();
            if (data.payment_url) {
              if (!cancelled) setPaymentUrl(data.payment_url);
              return;
            }
            if (data.skip) {
              // Not a Zcash order
              return;
            }
          }

          // No payment URL yet -- invoice may not be created yet
          if (attempt < MAX_RETRIES) {
            if (!cancelled) {
              setDebug(`Waiting for invoice... (attempt ${attempt}/${MAX_RETRIES})`);
            }
            await sleep(RETRY_DELAY_MS);
          }
        } catch (err) {
          console.error("CipherPay extension error:", err);
          if (attempt < MAX_RETRIES) {
            await sleep(RETRY_DELAY_MS);
          }
        }
      }

      if (!cancelled) {
        setDebug(`Could not load payment after ${MAX_RETRIES} attempts`);
      }
    }

    fetchWithRetry().finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; };
  }, [orderId, shopDomain]);

  if (loading) {
    return (
      <s-box padding="base" borderRadius="base">
        <s-stack blockAlignment="center" inlineAlignment="center" gap="base">
          <s-spinner />
          <s-text>{debug || "Loading payment details..."}</s-text>
        </s-stack>
      </s-box>
    );
  }

  if (debug && !paymentUrl) {
    return (
      <s-box padding="base" borderRadius="base" border="base">
        <s-text size="small" appearance="subdued">CipherPay: {debug}</s-text>
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
