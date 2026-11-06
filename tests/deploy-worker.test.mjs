import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

Object.assign(process.env, {
  UPSTASH_REDIS_REST_URL: 'https://fixture.upstash.io',
  UPSTASH_REDIS_REST_TOKEN: 'fixture-redis-token',
  QSTASH_CURRENT_SIGNING_KEY: 'fixture-current',
  QSTASH_NEXT_SIGNING_KEY: 'fixture-next',
  SHOPIFY_CREDENTIALS_KEY: 'fixture-credentials-key',
  SHOPIFY_CLI_PARTNERS_TOKEN: 'inherited-partners-token',
});

const { parseDeployResult, prepareAppDirectory, sanitizeOutput, shopifyTokenEnv } = await import('../scripts/shopify-deploy-worker.mjs');

async function fixtureExtensions({ withModules }) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'deploy-worker-fixture-'));
  const extension = path.join(dir, 'cipherpay-checkout');
  await fs.mkdir(path.join(extension, 'src'), { recursive: true });
  await fs.mkdir(path.join(extension, 'dist'));
  await fs.writeFile(path.join(extension, 'shopify.extension.toml'), 'api_version = "2026-01"\n');
  await fs.writeFile(path.join(extension, 'package.json'), '{}\n');
  await fs.writeFile(path.join(extension, 'src', 'ThankYouPage.jsx'), '');
  await fs.writeFile(path.join(extension, 'dist', 'stale.js'), '');
  if (withModules) {
    await fs.mkdir(path.join(extension, 'node_modules', 'preact', 'dist'), { recursive: true });
    await fs.writeFile(path.join(extension, 'node_modules', 'preact', 'dist', 'preact.module.js'), '');
  }
  return dir;
}

test('deploys from an isolated directory with only the config and extensions', async () => {
  const extensions = await fixtureExtensions({ withModules: true });
  const appDir = await prepareAppDirectory('client_id = "x"\n', extensions);
  try {
    assert.ok(appDir.startsWith(os.tmpdir()));
    assert.deepEqual((await fs.readdir(appDir)).sort(), ['extensions', 'package.json', 'shopify.app.worker.toml']);
    assert.equal(await fs.readFile(path.join(appDir, 'shopify.app.worker.toml'), 'utf8'), 'client_id = "x"\n');
    const copied = path.join(appDir, 'extensions', 'cipherpay-checkout');
    assert.deepEqual((await fs.readdir(copied)).sort(), ['node_modules', 'package.json', 'shopify.extension.toml', 'src']);
    // Dependency build output must survive; esbuild resolves preact from it.
    await fs.access(path.join(copied, 'node_modules', 'preact', 'dist', 'preact.module.js'));
  } finally {
    await fs.rm(appDir, { recursive: true, force: true });
    await fs.rm(extensions, { recursive: true, force: true });
  }
});

test('fails clearly when extension dependencies are not installed', async () => {
  const extensions = await fixtureExtensions({ withModules: false });
  try {
    await assert.rejects(prepareAppDirectory('', extensions), /missing dependencies for extension cipherpay-checkout/);
  } finally {
    await fs.rm(extensions, { recursive: true, force: true });
  }
});

test('passes exactly one Shopify token variable and no worker secrets to the CLI', () => {
  const service = shopifyTokenEnv('service-account-fixture');
  assert.equal(service.SHOPIFY_SERVICE_ACCOUNT_TOKEN, 'service-account-fixture');
  assert.equal(service.SHOPIFY_APP_AUTOMATION_TOKEN, undefined);
  assert.equal(service.SHOPIFY_CLI_PARTNERS_TOKEN, undefined);
  for (const name of ['SHOPIFY_CREDENTIALS_KEY', 'UPSTASH_REDIS_REST_TOKEN', 'QSTASH_CURRENT_SIGNING_KEY']) {
    assert.equal(service[name], undefined);
  }

  const automation = shopifyTokenEnv('atkn_fixture');
  assert.equal(automation.SHOPIFY_APP_AUTOMATION_TOKEN, 'atkn_fixture');
  assert.equal(automation.SHOPIFY_SERVICE_ACCOUNT_TOKEN, undefined);
});

test('merchant-facing errors hide tokens and worker paths but keep URLs', () => {
  const output = sanitizeOutput(
    "EACCES: permission denied, scandir '/opt/cipherpay-shopify/releases/audit-20260908' token secret-value atkn_abc123 see https://shopify.dev/docs/apps",
    'secret-value'
  );
  assert.equal(
    output,
    "EACCES: permission denied, scandir '[path]' token [redacted] [redacted] see https://shopify.dev/docs/apps"
  );
});

test('a version Shopify refused to release is reported as needing network access', () => {
  const stdout = `Bundling...\n${JSON.stringify({
    app: { name: 'CipherPay', clientId: 'x' },
    deployment: { released: false, version: { gid: 'g', name: 'cipherpay-2', message: null, url: 'https://dev.shopify.com/v/2' } },
    status: 'partial',
    errors: [{ type: 'abort', message: 'Network access must be requested and approved in order for the cipherpay-checkout extension to be published.' }],
  }, null, 2)}\n`;
  assert.deepEqual(parseDeployResult(stdout), {
    released: false,
    version: { name: 'cipherpay-2', url: 'https://dev.shopify.com/v/2' },
    errorCode: 'network_access_required',
    message: 'Network access must be requested and approved in order for the cipherpay-checkout extension to be published.',
  });
});

test('other unreleased versions are release failures, released versions succeed', () => {
  const partial = JSON.stringify({ deployment: { released: false, version: { name: 'v3', url: null } }, status: 'partial', errors: [{ message: 'Something else' }] });
  assert.equal(parseDeployResult(partial).errorCode, 'release_failed');
  const ok = JSON.stringify({ deployment: { released: true, version: { name: 'v4', url: 'u' } }, status: 'success' });
  assert.deepEqual(parseDeployResult(ok), { released: true, version: { name: 'v4', url: 'u' }, errorCode: null, message: null });
});

test('falls back to the text output when the CLI prints no JSON', () => {
  assert.equal(parseDeployResult('New version created, but not released.\n  Network access must be requested').errorCode, 'network_access_required');
  assert.equal(parseDeployResult('New version released to users.').released, true);
});
