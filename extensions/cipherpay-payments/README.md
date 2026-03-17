# CipherPay Payments Extension (Pending Approval)

This is the native Shopify Payments Extension (offsite) for CipherPay.

It provides a native payment method selector in Shopify checkout with a logo,
redirect-based payment flow, and proper session management — replacing the
manual payment method workaround.

## Status: Waiting for Payments Partner Approval

Shopify's payments platform is **invite-only**. The `payments_app_extension_offsite`
extension type is gated behind Payments Partner approval.

## To activate (after approval):

1. Rename this directory:
   ```bash
   mv extensions/_cipherpay-payments extensions/cipherpay-payments
   ```

2. Update `shopify.app.toml` scopes:
   ```toml
   [access_scopes]
   scopes = "write_payment_gateways,write_payment_sessions"
   ```

3. Deploy:
   ```bash
   npx shopify app deploy
   ```

## Related endpoints (already built):

- `app/api/payments/session/route.ts` — Payment session handler
- `app/api/payments/refund/route.ts` — Refund handler
- `app/api/payments/capture/route.ts` — Capture handler
- `app/api/payments/void/route.ts` — Void handler
- `app/api/payments/return/route.ts` — Customer return page
- `lib/shopify-payments.ts` — Payments Apps GraphQL API client
