/** @jsxImportSource preact */
import "@shopify/ui-extensions/preact";
import { render } from "preact";

const API_BASE = "https://connect.cipherpay.app";
const ZEC_KEYWORDS = /zcash|zec|cipherpay/i;

function normalizeOrderId(orderId) {
  if (!orderId) return null;
  return String(orderId).replace("gid://shopify/Order/", "");
}

function isZcashPayment() {
  try {
    const sig = shopify.selectedPaymentOptions ?? shopify.payments?.selectedPaymentOptions;
    const options = sig?.value ?? sig?.current;
    if (!options || !Array.isArray(options)) return true; // fail open — server handles non-Zcash
    return options.some(
      (opt) =>
        opt.type === "manualPayment" ||
        (opt.handle && ZEC_KEYWORDS.test(opt.handle))
    );
  } catch (_) {
    return true; // fail open
  }
}

export default function () {
  render(<CipherPayOrderStatus />, document.body);
}

function CipherPayOrderStatus() {
  const orderId = normalizeOrderId(shopify.order.value?.id);
  const shopDomain = shopify.shop.myshopifyDomain;

  if (!orderId || !shopDomain) return null;
  if (!isZcashPayment()) return null;

  const redirectUrl = `${API_BASE}/api/extension/redirect?shop=${encodeURIComponent(shopDomain)}&order_id=${encodeURIComponent(orderId)}`;

  return (
    <s-box border="base" padding="base" borderRadius="base">
      <s-stack gap="base">
        <s-heading>Zcash Payment</s-heading>
        <s-text>
          Click below to complete or check the status of your Zcash (ZEC)
          payment.
        </s-text>
        <s-button
          variant="primary"
          href={redirectUrl}
          target="_blank"
        >
          Pay with Zcash (ZEC)
        </s-button>
      </s-stack>
    </s-box>
  );
}
