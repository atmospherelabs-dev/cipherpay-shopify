#!/usr/bin/env node
import crypto from 'crypto';
import fs from 'fs/promises';
import { realpathSync } from 'fs';
import os from 'os';
import path from 'path';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawn } from 'child_process';
import { Redis } from '@upstash/redis';
import { Receiver } from '@upstash/qstash';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const receiver = new Receiver({
  currentSigningKey: requireEnv('QSTASH_CURRENT_SIGNING_KEY'),
  nextSigningKey: requireEnv('QSTASH_NEXT_SIGNING_KEY'),
});

const PORT = Number(process.env.DEPLOY_WORKER_PORT || 9100);

// Resolve the app source and the pinned Shopify CLI from this script, not from
// the worker's working directory.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXTENSIONS_DIR = path.join(REPO_ROOT, 'extensions');
const SHOPIFY_CLI_BIN = path.join(
  path.dirname(createRequire(import.meta.url).resolve('@shopify/cli/package.json')),
  'bin',
  'run.js'
);

const SHOPIFY_TOKEN_ENV_VARS = [
  'SHOPIFY_SERVICE_ACCOUNT_TOKEN',
  'SHOPIFY_APP_AUTOMATION_TOKEN',
  'SHOPIFY_CLI_PARTNERS_TOKEN',
];

// Worker secrets the CLI never needs.
const WORKER_SECRET_ENV_VARS = [
  'SHOPIFY_CREDENTIALS_KEY',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
  'QSTASH_CURRENT_SIGNING_KEY',
  'QSTASH_NEXT_SIGNING_KEY',
];

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function credentialEncryptionKey() {
  const value = requireEnv('SHOPIFY_CREDENTIALS_KEY');
  if (/^[a-f0-9]{64}$/i.test(value)) {
    return Buffer.from(value, 'hex');
  }

  const base64 = Buffer.from(value, 'base64');
  if (base64.length === 32) {
    return base64;
  }

  return crypto.createHash('sha256').update(value).digest();
}

function decryptSecret(encryptedSecret) {
  const [version, iv, authTag, encrypted] = encryptedSecret.split(':');
  if (version !== 'v1' || !iv || !authTag || !encrypted) {
    throw new Error('Invalid encrypted Shopify deploy token format');
  }

  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    credentialEncryptionKey(),
    Buffer.from(iv, 'base64')
  );
  decipher.setAuthTag(Buffer.from(authTag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

function jobKey(id) {
  return `shopify-deploy-job:${id}`;
}

function statusKey(id) {
  return `shopify-deploy-status:${id}`;
}

function parseRedisJson(value) {
  if (!value) return null;
  return typeof value === 'string' ? JSON.parse(value) : value;
}

async function updateStatus(id, patch) {
  const current = parseRedisJson(await redis.get(statusKey(id)));
  if (!current) return;

  await redis.set(statusKey(id), JSON.stringify({
    ...current,
    ...patch,
    updated_at: new Date().toISOString(),
  }), { ex: 86400 });
}

export function sanitizeOutput(output, token) {
  const redacted = token ? output.replaceAll(token, '[redacted]') : output;
  return redacted
    .replace(/shpss_[a-zA-Z0-9]+/g, '[redacted]')
    .replace(/atkn_[a-zA-Z0-9]+/g, '[redacted]')
    // Deploy status is shown to merchants; keep worker filesystem paths out of it.
    .replace(/(^|[\s'"`(=:])\/(?:[\w.@+-]+\/)*[\w.@+-]+/gm, '$1[path]');
}

// Shopify now issues service account tokens; App Automation Tokens keep their
// atkn_ prefix. The CLI rejects more than one token variable at once.
export function shopifyTokenEnv(token) {
  const env = { ...process.env };
  for (const name of [...SHOPIFY_TOKEN_ENV_VARS, ...WORKER_SECRET_ENV_VARS]) delete env[name];
  const name = token.startsWith('atkn_') ? 'SHOPIFY_APP_AUTOMATION_TOKEN' : 'SHOPIFY_SERVICE_ACCOUNT_TOKEN';
  env[name] = token;
  return env;
}

// `app deploy` bundles extensions but does not install their dependencies.
async function assertExtensionDependencies(extensionsDir) {
  for (const entry of await fs.readdir(extensionsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const extensionDir = path.join(extensionsDir, entry.name);
    const hasPackage = await fs.access(path.join(extensionDir, 'package.json')).then(() => true, () => false);
    const hasModules = await fs.access(path.join(extensionDir, 'node_modules')).then(() => true, () => false);
    if (hasPackage && !hasModules) {
      throw new Error(`Deploy worker is missing dependencies for extension ${entry.name}`);
    }
  }
}

// The CLI searches the whole app directory for web and extension configs, so
// deploy from a private directory holding only the generated config and the
// extensions.
export async function prepareAppDirectory(config, extensionsDir = EXTENSIONS_DIR) {
  await assertExtensionDependencies(extensionsDir);
  const appDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cipherpay-shopify-deploy-'));
  await fs.writeFile(path.join(appDir, 'shopify.app.worker.toml'), config, { mode: 0o600 });
  await fs.writeFile(
    path.join(appDir, 'package.json'),
    `${JSON.stringify({ name: 'cipherpay-shopify-deploy', private: true }, null, 2)}\n`
  );
  await fs.cp(extensionsDir, path.join(appDir, 'extensions'), {
    recursive: true,
    filter: (source) => path.basename(source) !== 'dist',
  });
  return appDir;
}

export async function runShopifyDeploy(job, automationToken) {
  const appUrl = `${job.host}/api/auth/tenant/${job.client_id}`;
  const redirectUrl = `${job.host}/api/auth/callback`;

  // JSON string literals are valid TOML basic strings.
  const config = `client_id = ${JSON.stringify(job.client_id)}
name = ${JSON.stringify(job.app_name)}
application_url = ${JSON.stringify(appUrl)}
embedded = false

[webhooks]
api_version = "2026-04"

[access_scopes]
scopes = "read_orders,write_orders"
optional_scopes = [ ]
use_legacy_install_flow = false

[auth]
redirect_urls = [ ${JSON.stringify(redirectUrl)} ]
`;

  const appDir = await prepareAppDirectory(config);

  try {
    const result = await new Promise((resolve) => {
      const child = spawn(process.execPath, [
        SHOPIFY_CLI_BIN,
        'app',
        'deploy',
        '--path',
        appDir,
        '--config',
        'worker',
        '--allow-updates',
      ], {
        cwd: appDir,
        env: shopifyTokenEnv(automationToken),
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
      child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
      child.on('error', (error) => resolve({ code: -1, stdout, stderr: `${stderr}\n${error.message}` }));
      child.on('close', (code) => resolve({ code, stdout, stderr }));
    });

    if (result.code !== 0) {
      const output = sanitizeOutput(`${result.stdout}\n${result.stderr}`, automationToken).slice(-4000);
      throw new Error(`Shopify deploy failed with code ${result.code}: ${output}`);
    }
  } finally {
    await fs.rm(appDir, { recursive: true, force: true });
  }
}

async function processJob(id) {
  const job = parseRedisJson(await redis.get(jobKey(id)));
  if (!job) {
    console.log(`Job ${id} not found (already processed or expired)`);
    return;
  }

  console.log(`Processing deploy job ${id} for app ${job.client_id}`);
  await updateStatus(id, { status: 'processing', error: null });

  let automationToken = '';
  try {
    automationToken = decryptSecret(job.encrypted_automation_token);
    await runShopifyDeploy(job, automationToken);
    await updateStatus(id, { status: 'deployed', error: null });
    console.log(`Deploy job ${id} completed successfully`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown deploy error';
    await updateStatus(id, { status: 'failed', error: sanitizeOutput(message, automationToken).slice(0, 4000) });
    console.error(`Deploy job ${id} failed:`, sanitizeOutput(message, automationToken).slice(0, 500));
  } finally {
    automationToken = '';
    await redis.del(jobKey(id));
  }
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString();
}

function main() {
  requireEnv('UPSTASH_REDIS_REST_URL');
  requireEnv('UPSTASH_REDIS_REST_TOKEN');
  requireEnv('SHOPIFY_CREDENTIALS_KEY');

  const server = createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/deploy') {
      res.writeHead(404);
      res.end();
      return;
    }

    const body = await readBody(req);

    const signature = req.headers['upstash-signature'];
    if (!signature || typeof signature !== 'string') {
      res.writeHead(401);
      res.end();
      return;
    }

    try {
      await receiver.verify({ signature, body });
    } catch {
      console.warn('QStash signature verification failed');
      res.writeHead(401);
      res.end();
      return;
    }

    let jobId;
    try {
      const parsed = JSON.parse(body);
      jobId = parsed.jobId;
    } catch {
      res.writeHead(400);
      res.end();
      return;
    }

    if (!jobId || typeof jobId !== 'string') {
      res.writeHead(400);
      res.end();
      return;
    }

    try {
      await processJob(jobId);
      res.writeHead(200);
      res.end('OK');
    } catch (error) {
      console.error('Unhandled error processing deploy job:', error);
      res.writeHead(500);
      res.end();
    }
  });

  server.listen(PORT, () => {
    console.log(`CipherPay Shopify deploy worker listening on port ${PORT}`);
  });
}

// Compare real paths: Node resolves symlinks (e.g. a release symlink) in import.meta.url.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
