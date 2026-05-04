/** @jsxImportSource preact */
import "@shopify/ui-extensions/preact";
import { render } from "preact";

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
  const orderId = getOrderId();
  const shop = getShop();

  if (!orderId || !shop) return null;

  const redirectUrl = `${API_BASE}/api/extension/redirect?shop=${encodeURIComponent(shop)}&order_id=${encodeURIComponent(orderId)}`;

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
      <s-box padding="small none none none">
        <s-button variant="primary" href={redirectUrl} target="_blank">
          Pay with CipherPay
        </s-button>
      </s-box>
    </s-stack>
  );
}
