#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 <client_id> <cli_token> [app_name]" >&2
  echo "Example: $0 abc123 shpat_xxx CipherPay" >&2
}

if [ "${1:-}" = "" ] || [ "${2:-}" = "" ]; then
  usage
  exit 1
fi

CLIENT_ID="$1"
CLI_TOKEN="$2"
APP_NAME="${3:-CipherPay}"
HOST="${HOST:-https://connect.cipherpay.app}"
CONFIG_NAME="shopify.app.merchant-${CLIENT_ID}.toml"
CONFIG_PATH="./${CONFIG_NAME}"

cleanup() {
  rm -f "${CONFIG_PATH}"
  unset SHOPIFY_CLI_PARTNERS_TOKEN
  unset SHOPIFY_APP_AUTOMATION_TOKEN
}
trap cleanup EXIT

cat > "${CONFIG_PATH}" <<EOF
client_id = "${CLIENT_ID}"
name = "${APP_NAME}"
application_url = "${HOST}/api/auth/tenant/${CLIENT_ID}"
embedded = false

[webhooks]
api_version = "2026-04"

[access_scopes]
scopes = "read_orders,write_orders"
optional_scopes = [ ]
use_legacy_install_flow = false

[auth]
redirect_urls = [ "${HOST}/api/auth/callback" ]
EOF

# Support both Shopify token env names. The token is only held in-process and
# the generated config is deleted immediately after deployment.
export SHOPIFY_CLI_PARTNERS_TOKEN="${CLI_TOKEN}"
export SHOPIFY_APP_AUTOMATION_TOKEN="${CLI_TOKEN}"

npx shopify app deploy --config "${CONFIG_NAME}" --allow-updates

echo "Extension deployed to app ${CLIENT_ID} (${APP_NAME})."
echo "Use App URL: ${HOST}/api/auth/tenant/${CLIENT_ID}"
echo "Use Redirect URL: ${HOST}/api/auth/callback"
