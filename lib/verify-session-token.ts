import { jwtVerify } from 'jose';

const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY!;
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET!;

interface ShopifySessionPayload {
  iss: string;
  dest: string;
  aud: string;
  sub: string;
  exp: number;
  iat: number;
  jti: string;
}

/**
 * Verify a Shopify session token (JWT) issued by App Bridge.
 * Returns the shop domain (e.g. "mystore.myshopify.com") on success.
 * Throws on invalid/expired tokens.
 */
export async function verifyShopifySessionToken(token: string): Promise<string> {
  const secret = new TextEncoder().encode(SHOPIFY_API_SECRET);

  const { payload } = await jwtVerify(token, secret, {
    algorithms: ['HS256'],
    audience: SHOPIFY_API_KEY,
    clockTolerance: 10,
  });

  const sessionPayload = payload as unknown as ShopifySessionPayload;

  // Extract shop domain from `dest` (e.g. "https://mystore.myshopify.com")
  const destUrl = new URL(sessionPayload.dest);
  const shop = destUrl.hostname;

  if (!shop.endsWith('.myshopify.com')) {
    throw new Error(`Invalid shop domain in token: ${shop}`);
  }

  return shop;
}
