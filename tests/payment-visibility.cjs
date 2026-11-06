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

test('session tokens are verified with the issuing app secret and bound to its store', async () => {
  const jose = require('jose');
  const sign = (secret, aud, dest) => new jose.SignJWT({ dest: `https://${dest}` })
    .setProtectedHeader({ alg: 'HS256' }).setAudience(aud).setIssuedAt().setExpirationTime('5m')
    .sign(new TextEncoder().encode(secret));
  const apps = { tenant: { client_secret: 'tenant-secret-0123456789', shop_domain: 'merchant.myshopify.com' } };
  const { verifyShopifySessionToken: verify } = load('lib/verify-session-token.ts', {
    jose, '@/lib/db': { getShopifyAppCredentials: async (id) => apps[id] ?? null },
  }, { SHOPIFY_API_KEY: 'shared', SHOPIFY_API_SECRET: 'shared-secret-0123456789' });

  assert.equal(await verify(await sign('tenant-secret-0123456789', 'tenant', 'merchant.myshopify.com')), 'merchant.myshopify.com');
  assert.equal(await verify(await sign('shared-secret-0123456789', 'shared', 'other.myshopify.com')), 'other.myshopify.com');
  await assert.rejects(verify(await sign('wrong-secret-0123456789', 'tenant', 'merchant.myshopify.com')));
  await assert.rejects(verify(await sign('tenant-secret-0123456789', 'tenant', 'someone-else.myshopify.com')), /does not match/);
  await assert.rejects(verify(await sign('any-secret-0123456789ab', 'unknown', 'merchant.myshopify.com')), /Unknown Shopify app/);
});

test('payment requests without a valid session token are rejected even for a configured shop', async () => {
  let fetched = 0;
  const route = load('app/api/extension/payment/route.ts', {
    '@/lib/db': { getShop: async () => ({ cipherpay_api_key: 'fixture', cipherpay_api_url: 'https://api.cipherpay.app' }) },
    '@/lib/cipherpay': { createInvoice: async () => { throw new Error('must not create'); } },
    '@/lib/shopify': { shopifyAdminApi: async () => { fetched++; return {}; } },
    '@/lib/verify-session-token': { verifyShopifySessionToken: async () => { throw new Error('signature verification failed'); } },
  });
  for (const headers of [new Headers(), new Headers({ authorization: 'Bearer forged' })]) {
    const res = await route.POST({ headers, json: async () => ({ shop: 'a.myshopify.com', order_id: '12345' }) });
    assert.equal(res.status, 401);
  }
  assert.equal(fetched, 0);
});

for (const page of ['ThankYouPage', 'OrderStatusPage']) {
  test(`${page} never calls the server for editor previews or placeholder orders, and stops polling`, async () => {
    const run = async ({ editor, orderGid, response }) => {
      let component, effect, cursor = 0, fetches = 0, timers = 0;
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
        shopify: { extension: editor ? { editor: { type: 'checkout' } } : {},
          orderConfirmation: { value: { order: { id: orderGid } } }, order: { value: { id: orderGid } },
          shop: { myshopifyDomain: 'a.myshopify.com' }, sessionToken: { get: async () => 'valid' } },
        fetch: async () => { fetches++; return { ok: true, status: 200, json: async () => response }; },
        // Run retries immediately to exercise the polling cap.
        setTimeout: (fn) => { timers++; Promise.resolve().then(fn); return timers; }, clearTimeout: () => {},
      });
      api.default();
      cursor = 0;
      const first = component();
      effect();
      for (let i = 0; i < 200; i++) await new Promise(resolve => setImmediate(resolve));
      return { first, fetches };
    };

    const preview = await run({ editor: true, orderGid: 'gid://shopify/Order/12345', response: { pending: true } });
    assert.ok(preview.first, 'editor shows a placeholder so merchants see the block');
    assert.equal(preview.fetches, 0);
    assert.equal((await run({ editor: false, orderGid: 'gid://shopify/OrderIdentity/0', response: { pending: true } })).fetches, 0);
    const pending = await run({ editor: false, orderGid: 'gid://shopify/Order/12345', response: { pending: true } });
    assert.equal(pending.fetches, 30, 'polling stops after the attempt cap');
  });
}
