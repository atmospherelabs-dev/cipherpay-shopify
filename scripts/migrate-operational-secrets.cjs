// Run only after promoting the bridge that understands encryption_version: 1.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

if (!process.argv.includes('--apply-after-bridge-promotion')) {
  throw new Error('Promote the compatible Shopify bridge first, then pass --apply-after-bridge-promotion');
}
for (const key of ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'SHOPIFY_CREDENTIALS_KEY']) {
  if (!process.env[key]) throw new Error(`${key} is required`);
}
const filename = path.resolve(__dirname, '../lib/db.ts');
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText;
const loaded = new Module(filename, module);
loaded.filename = filename;
loaded.paths = Module._nodeModulePaths(path.dirname(filename));
loaded._compile(compiled, filename);
loaded.exports.migrateOperationalSecrets().then(count => {
  console.log(`Encrypted ${count} legacy operational credential records`);
}).catch(() => {
  console.error('Credential migration failed; inspect configuration without printing secrets');
  process.exitCode = 1;
});
