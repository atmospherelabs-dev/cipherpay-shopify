const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(file, mocks = {}, env = {}, globals = {}) {
  const exports = {};
  const js = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX,
  }}).outputText;
  vm.runInNewContext(js, { ...globals, exports, Buffer, URL, Headers, AbortSignal, TextEncoder, console: { log(){}, warn(){}, error(){} },
    process: { env }, require(name) {
      if (name in mocks) return mocks[name];
      if (name === 'next/server') return { NextResponse: { json(body, options = {}) { return { status: options.status || 200, body }; } } };
      if (name === 'crypto') return require('node:crypto');
      throw new Error(`Unexpected import: ${name}`);
    },
  }, { filename: file });
  return exports;
}
test('payment links require a pending Zcash order even when an invoice already exists', async () => {
  let order, existing, lookups = 0, locks = 0, invoices = 0;
  const route = load('app/api/extension/payment/route.ts', {
    '@/lib/db': {
      getShop: async () => ({ cipherpay_api_key: 'fixture', cipherpay_api_url: 'https://api.cipherpay.app' }),
      getPaymentSessionByOrderId: async () => { lookups++; return existing; },
      acquireOrderLock: async () => { locks++; return true; },
      createPaymentSession: async () => {},
    },
    '@/lib/cipherpay': { createInvoice: async () => { invoices++; return { id: 'new', checkout_token: 'a'.repeat(64) }; } },
    '@/lib/shopify': { shopifyAdminApi: async () => ({ order }) },
    '@/lib/verify-session-token': { verifyShopifySessionToken: async () => 'a.myshopify.com' },
  });
  const req = { headers: new Headers({ authorization: 'Bearer valid' }), json: async () => ({
    shop: 'a.myshopify.com', order_id: '12345', checkout_token: 'secret-checkout-123456',
  }) };
  const base = { total_price: '12', currency: 'USD', checkout_token: 'secret-checkout-123456', financial_status: 'pending' };
  existing = { cipherpay_invoice_id: 'old', status: 'pending' };
  for (const method of ['shopify_payments', 'Shop Pay', 'paypal', 'Bank Deposit', 'Cash on Delivery', '']) {
    order = { ...base, payment_gateway_names: [method] };
    assert.equal((await route.POST(req)).body.skip, true, method);
  }
  for (const status of ['paid', 'authorized', 'partially_paid', 'partially_refunded', 'refunded', 'voided', undefined]) {
    order = { ...base, gateway: 'Zcash', financial_status: status };
    assert.equal((await route.POST(req)).body.skip, true, status);
  }
  order = { ...base, gateway: 'Zcash', cancelled_at: '2026-10-08T00:00:00Z' };
  assert.equal((await route.POST(req)).body.skip, true);
  order = null;
  assert.equal((await route.POST(req)).body.pending, true);
  assert.equal(lookups, 0); assert.equal(locks, 0); assert.equal(invoices, 0);

  order = { ...base, payment_gateway_names: ['Zcash (ZEC) via CipherPay'] };
  existing = { cipherpay_invoice_id: 'old', status: 'confirmed' };
  assert.equal((await route.POST(req)).body.skip, true);
  existing.status = 'pending';
  assert.equal((await route.POST(req)).body.invoice_id, 'old');
  existing = null;
  assert.equal((await route.POST(req)).body.invoice_id, 'new');
  assert.equal(locks, 1); assert.equal(invoices, 1);
});

for (const page of ['ThankYouPage', 'OrderStatusPage']) {
  test(`${page} stays hidden until the server supplies a verified payment URL`, async () => {
    for (const response of [{ skip: true }, { skip: true, payment_url: 'https://cipherpay.app/pay/fixture' }, { pending: true }, { payment_url: 'https://cipherpay.app/pay/fixture' }, null]) {
      let component, effect, cursor = 0;
      const state = [];
      const jsx = (type, props) => ({ type, props });
      const api = load(`extensions/cipherpay-checkout/src/${page}.jsx`, {
        '@shopify/ui-extensions/preact': {},
        'preact/jsx-runtime': { jsx, jsxs: jsx },
        preact: { render: vnode => { component = vnode.type; } },
        'preact/hooks': {
          useState(initial) { const index = cursor++; if (!(index in state)) state[index] = initial;
            return [state[index], value => { state[index] = value; }]; },
          useEffect(callback) { effect = callback; },
        },
      }, {}, {
        document: { body: {} },
        shopify: { orderConfirmation: { value: { order: { id: 'gid://shopify/Order/12345' } } },
          order: { value: { id: 'gid://shopify/Order/12345' } }, shop: { myshopifyDomain: 'a.myshopify.com' },
          sessionToken: { get: async () => 'valid' } },
        fetch: async () => { if (!response) throw Error('Network failure'); return { ok: true, json: async () => response }; },
        setTimeout: () => 1, clearTimeout: () => {},
      });
      api.default();
      assert.equal(component(), null, 'no payment block before verification, even without selectedPaymentOptions');
      const cleanup = effect();
      await new Promise(resolve => setImmediate(resolve));
      cursor = 0;
      const rendered = component();
      assert.equal(Boolean(rendered), Boolean(!response?.skip && response?.payment_url));
      cleanup();
    }
  });
}
