const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(file, mocks = {}, env = {}) {
  const exports = {};
  const js = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  }}).outputText;
  vm.runInNewContext(js, { exports, Buffer, URL, Headers, AbortSignal, TextEncoder, console: { log(){}, warn(){}, error(){} },
    process: { env }, require(name) {
      if (name in mocks) return mocks[name];
      if (name === 'next/server') return { NextResponse: { json(body, options = {}) { return { status: options.status || 200, body }; } } };
      if (name === 'crypto') return require('node:crypto');
      throw new Error(`Unexpected import: ${name}`);
    },
  }, { filename: file });
  return exports;
}
const cipher = load('lib/cipherpay.ts');
test('credential destinations reject SSRF, redirects, credentials, and unexpected paths', () => {
  for (const url of ['http://api.cipherpay.app','https://evil.test','https://api.cipherpay.app.evil.test','https://api.cipherpay.app/path','https://user:password@api.cipherpay.app','https://127.0.0.1','https://api.cipherpay.app/?redirect=evil']) {
    assert.throws(() => cipher.validateCipherPayApiUrl(url));
  }
  assert.equal(cipher.validateCipherPayApiUrl('https://api.cipherpay.app/'),'https://api.cipherpay.app');
});
test('settings require the authenticated shop and same-origin request; masked fields preserve secrets', async () => {
  let written;
  const route = load('app/api/settings/route.ts', {
    '@/lib/db': { verifySessionToken: async () => true, getShop: async shop => ({ shop }), updateShopConfig: async (shop,config) => { written={shop,config}; } },
    '@/lib/cipherpay': cipher,
    '@/lib/settings-session': { readSettingsSession: () => ({shop:'a.myshopify.com',token:'fixture'}) },
  });
  const req = (shop,origin='https://bridge.test') => ({ nextUrl:new URL('https://bridge.test/api/settings?shop=a.myshopify.com'),headers:new Headers({origin}),json:async()=>({shop,cipherpay_api_key:'••••••',cipherpay_api_url:'https://api.cipherpay.app'}) });
  assert.equal((await route.POST(req('b.myshopify.com'))).status,403);assert.equal(written,undefined);
  assert.equal((await route.POST(req('a.myshopify.com','https://evil.test'))).status,403);
  assert.equal((await route.POST(req('a.myshopify.com'))).status,200);
  assert.equal(written.shop,'a.myshopify.com');assert.equal(written.config.cipherpay_api_key,undefined);
});
test('order access fails closed for missing JWT, wrong tenant, and another checkout', async () => {
  let orderReads=0;
  const route=load('app/api/extension/payment/route.ts',{
    '@/lib/db': { getShop:async shop=>({shop,cipherpay_api_key:'fixture',cipherpay_api_url:'https://api.cipherpay.app'}),getPaymentSessionByOrderId:async()=>({cipherpay_invoice_id:'invoice',status:'pending'}) },
    '@/lib/cipherpay':cipher,
    '@/lib/shopify':{shopifyAdminApi:async()=>{orderReads++;return {order:{checkout_token:'secret-checkout-123456',total_price:'1',currency:'USD'}};}},
    '@/lib/verify-session-token':{verifyShopifySessionClaims:async token=>{if(token!=='valid')throw Error();return {shop:'a.myshopify.com'};}},
  });
  const req=(token,shop='a.myshopify.com',checkout='wrong-checkout-123456')=>({headers:new Headers(token?{authorization:`Bearer ${token}`} : {}),json:async()=>({shop,order_id:'12345',checkout_token:checkout})});
  assert.equal((await route.POST(req())).status,401);assert.equal((await route.POST(req('invalid'))).status,401);
  assert.equal((await route.POST(req('valid','b.myshopify.com'))).status,403);assert.equal(orderReads,0);
  assert.equal((await route.POST(req('valid'))).status,403);
  const good=await route.POST(req('valid','a.myshopify.com','secret-checkout-123456'));assert.equal(good.status,200);assert.equal(good.body.invoice_id,'invoice');
});
test('fulfillment retries failures and ignores regressive or duplicate events', async () => {
  let status='pending',fail=true,attempts=0,completed=0,event='confirmed';
  const service=load('lib/fulfillment.ts',{
    './db': {getFulfillment:async()=>({invoiceId:'one',shop:'a',event}),acquireFulfillmentLock:async()=> 'lock',releaseFulfillmentLock:async()=>{},
      getShop:async()=>({access_token:'fixture'}),getPaymentSessionByInvoiceId:async()=>({id:'one',shop:'a',status,shopify_order_id:'123'}),
      updatePaymentSession:async(_,v)=>{status=v.status;},getShopifyPaymentSessionByInvoiceId:async()=>null,completeFulfillment:async()=>{completed++;}},
    './shopify':{markOrderAsPaid:async()=>{attempts++;if(fail)throw Error('outage');}},'./shopify-payments':{},
  });
  await assert.rejects(service.processFulfillment('job'));assert.equal(status,'pending');assert.equal(completed,0);
  fail=false;await service.processFulfillment('job');assert.equal(status,'confirmed');assert.equal(attempts,2);
  event='detected';await service.processFulfillment('job');event='confirmed';await service.processFulfillment('job');
  assert.equal(status,'confirmed');assert.equal(attempts,2);
});
test('JWT verification uses tenant credentials and validates audience/expiry', async () => {
  const jose=await import('jose');
  const secret=new TextEncoder().encode('fixture-secret-with-sufficient-entropy');
  const service=load('lib/verify-session-token.ts',{jose,'@/lib/db':{getShopifyAppCredentialsByShop:async()=>({client_id:'tenant-client',client_secret:new TextDecoder().decode(secret)})}});
  const sign=(aud,expiration)=>new jose.SignJWT({dest:'a.myshopify.com',jti:'nonce'}).setProtectedHeader({alg:'HS256'}).setAudience(aud).setIssuedAt().setNotBefore('0s').setExpirationTime(expiration).sign(secret);
  const valid=await service.verifyShopifySessionClaims(await sign('tenant-client','5m'));assert.equal(valid.shop,'a.myshopify.com');
  await assert.rejects(service.verifyShopifySessionClaims(await sign('wrong-client','5m')));
  await assert.rejects(service.verifyShopifySessionClaims(await sign('tenant-client','-1m')));
});

test('operational credentials are encrypted, tampering fails, and uninstall revokes tenant sessions', async () => {
  const records = new Map();
  class Redis {
    async get(key) { return records.get(key) ?? null; }
    async set(key,value) { records.set(key,value); return 'OK'; }
    async del(...keys) { keys.forEach(key=>records.delete(key)); }
    async scan(cursor,{match}) { const prefix=match.slice(0,-1);return [0,[...records.keys()].filter(key=>key.startsWith(prefix))]; }
    async smembers() { return []; }
  }
  const db=load('lib/db.ts',{'@upstash/redis':{Redis},'@upstash/qstash':{Client:class {}}},{SHOPIFY_CREDENTIALS_KEY:'11'.repeat(32)});
  await db.saveShop('a.myshopify.com','private-shop-token');
  const encoded=records.get('shop:a.myshopify.com');
  assert.ok(!encoded.includes('private-shop-token'));
  assert.equal(JSON.parse(encoded).encryption_version,1);
  assert.equal((await db.getShop('a.myshopify.com')).access_token,'private-shop-token');
  const tampered=JSON.parse(encoded);const parts=tampered.access_token.split(':');parts[2]=Buffer.alloc(16).toString('base64');tampered.access_token=parts.join(':');
  records.set('shop:a.myshopify.com',JSON.stringify(tampered));
  await assert.rejects(()=>db.getShop('a.myshopify.com'));
  records.set('shop:a.myshopify.com',encoded);
  records.set('st:a.myshopify.com:legacy','valid');records.set('st-v2:a.myshopify.com:new','valid');
  records.set('st:b.myshopify.com:other','valid');
  await db.deleteShop('a.myshopify.com');
  assert.equal(records.has('shop:a.myshopify.com'),false);
  assert.equal(records.has('st:a.myshopify.com:legacy'),false);
  assert.equal(records.has('st-v2:a.myshopify.com:new'),false);
  assert.equal(records.has('st:b.myshopify.com:other'),true);
});
