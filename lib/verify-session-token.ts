import { decodeJwt, jwtVerify } from 'jose';
import { getShopifyAppCredentials } from '@/lib/db';

interface ShopifySessionPayload {
  iss: string;
  dest: string;
  aud: string;
  sub: string;
  exp: number;
  iat: number;
  jti: string;
}

function shopFromDest(dest: unknown): string {
  if (typeof dest !== 'string') throw new Error('Session token has no destination');
  const shop = new URL(dest.includes('://') ? dest : `https://${dest}`).hostname;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/.test(shop)) {
    throw new Error(`Invalid shop domain in token: ${shop}`);
  }
  return shop;
}

/**
 * Verify a Shopify session token (JWT) from App Bridge or a UI extension.
 *
 * Merchant-owned custom apps sign tokens with their own client secret, so the
 * secret is chosen by the token's audience (the app's client ID): the shared
 * app's environment credentials, or the stored credentials of a merchant app.
 * The audience is only used to pick the key; the signature is still verified.
 *
 * Returns the shop domain (e.g. "mystore.myshopify.com"). Throws otherwise.
 */
export async function verifyShopifySessionToken(token: string): Promise<string> {
  const unverified = decodeJwt(token);
  const audience = Array.isArray(unverified.aud) ? unverified.aud[0] : unverified.aud;
  if (!audience) throw new Error('Session token has no audience');

  let secret: string | undefined;
  let registeredShop: string | null = null;
  if (audience === process.env.SHOPIFY_API_KEY) {
    secret = process.env.SHOPIFY_API_SECRET;
  } else {
    const credentials = await getShopifyAppCredentials(audience);
    secret = credentials?.client_secret;
    registeredShop = credentials?.shop_domain ?? null;
  }
  if (!secret) throw new Error('Unknown Shopify app in session token');

  const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
    algorithms: ['HS256'],
    audience,
    clockTolerance: 10,
  });

  const shop = shopFromDest((payload as unknown as ShopifySessionPayload).dest);
  // A merchant app is registered for one store; reject tokens for any other.
  if (registeredShop && registeredShop !== shop) {
    throw new Error('Session token shop does not match the registered app');
  }
  return shop;
}
