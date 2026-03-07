/**
 * CipherPay Shopify Checkout Script
 *
 * Injected into Shopify's order status / thank-you page.
 * When a customer selects "Pay with Zcash (ZEC)" as the manual payment method,
 * this script detects it and creates a CipherPay invoice, then redirects
 * the customer to the CipherPay hosted checkout page.
 */
(function () {
  var script = document.currentScript;
  var appUrl = script ? script.src.replace('/checkout.js', '') : 'https://shopify.cipherpay.app';

  var shop = (script && script.getAttribute('data-shop')) ||
    (window.Shopify && window.Shopify.shop) ||
    window.location.hostname;

  if (!shop || !window.Shopify || !window.Shopify.checkout) return;

  var checkout = window.Shopify.checkout;
  var paymentMethod = (checkout.payment_due_method || '').toLowerCase();
  var gatewayName = (checkout.gateway || '').toLowerCase();

  var isZcashPayment =
    paymentMethod.includes('zcash') ||
    paymentMethod.includes('zec') ||
    paymentMethod.includes('cipherpay') ||
    gatewayName.includes('zcash') ||
    gatewayName.includes('zec') ||
    gatewayName.includes('cipherpay');

  if (!isZcashPayment) return;

  var statusEl = document.querySelector('.os-step__title');
  if (statusEl) {
    statusEl.innerHTML = '<span style="color: #00D4FF;">Processing ZEC payment...</span>';
  }

  var lineItems = [];
  if (checkout.line_items) {
    for (var i = 0; i < checkout.line_items.length; i++) {
      lineItems.push({ title: checkout.line_items[i].title });
    }
  }

  var payload = {
    shop: shop,
    order_id: checkout.order_id,
    order_number: checkout.order_number,
    amount: checkout.payment_due,
    currency: checkout.presentment_currency || checkout.currency || 'EUR',
    line_items: lineItems,
  };

  fetch(appUrl + '/api/payment/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
    .then(function (res) { return res.json(); })
    .then(function (data) {
      if (data.payment_url) {
        window.location.href = data.payment_url;
      } else {
        console.error('CipherPay: No payment URL returned', data);
      }
    })
    .catch(function (err) {
      console.error('CipherPay: Payment creation failed', err);
    });
})();
