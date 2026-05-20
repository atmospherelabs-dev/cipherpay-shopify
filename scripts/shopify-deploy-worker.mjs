#!/usr/bin/env node
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const QUEUE_KEY = 'shopify-deploy-queue';
const POLL_MS = Number(process.env.SHOPIFY_DEPLOY_WORKER_POLL_MS || 5000);

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

function sanitizeOutput(output, token) {
  return output
    .replaceAll(token, '[redacted]')
    .replace(/shpss_[a-zA-Z0-9]+/g, '[redacted]')
    .replace(/atkn_[a-zA-Z0-9]+/g, '[redacted]');
}

async function runShopifyDeploy(job, automationToken) {
  const repoRoot = process.cwd();
  const configName = `shopify.app.worker-${job.id}.toml`;
  const configPath = path.join(repoRoot, configName);
  const appUrl = `${job.host}/api/auth/tenant/${job.client_id}`;
  const redirectUrl = `${job.host}/api/auth/callback`;

  const config = `client_id = "${job.client_id}"
name = "${job.app_name}"
application_url = "${appUrl}"
embedded = false

[webhooks]
api_version = "2026-04"

[access_scopes]
scopes = "read_orders,write_orders"
optional_scopes = [ ]
use_legacy_install_flow = false

[auth]
redirect_urls = [ "${redirectUrl}" ]
`;

  await fs.writeFile(configPath, config, { mode: 0o600 });

  try {
    const env = {
      ...process.env,
      SHOPIFY_CLI_PARTNERS_TOKEN: automationToken,
      SHOPIFY_APP_AUTOMATION_TOKEN: automationToken,
    };

    const result = await new Promise((resolve) => {
      const child = spawn('npx', [
        'shopify',
        'app',
        'deploy',
        '--config',
        configName,
        '--allow-updates',
      ], {
        cwd: repoRoot,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
      child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
      child.on('close', (code) => resolve({ code, stdout, stderr }));
    });

    if (result.code !== 0) {
      const output = sanitizeOutput(`${result.stdout}\n${result.stderr}`, automationToken).slice(-4000);
      throw new Error(`Shopify deploy failed with code ${result.code}: ${output}`);
    }
  } finally {
    await fs.rm(configPath, { force: true });
  }
}

async function processJob(id) {
  const job = parseRedisJson(await redis.get(jobKey(id)));
  if (!job) {
    return;
  }

  await updateStatus(id, { status: 'processing', error: null });

  let automationToken = '';
  try {
    automationToken = decryptSecret(job.encrypted_automation_token);
    await runShopifyDeploy(job, automationToken);
    await updateStatus(id, { status: 'deployed', error: null });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown deploy error';
    await updateStatus(id, { status: 'failed', error: sanitizeOutput(message, automationToken).slice(0, 4000) });
  } finally {
    automationToken = '';
    await redis.del(jobKey(id));
  }
}

async function main() {
  requireEnv('UPSTASH_REDIS_REST_URL');
  requireEnv('UPSTASH_REDIS_REST_TOKEN');
  requireEnv('SHOPIFY_CREDENTIALS_KEY');

  console.log('CipherPay Shopify deploy worker started');

  while (true) {
    const id = await redis.rpop(QUEUE_KEY);
    if (id) {
      await processJob(String(id));
    } else {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
  }
}

main().catch((error) => {
  console.error('Shopify deploy worker crashed:', error);
  process.exit(1);
});
