import { decodeJwt, jwtVerify } from 'jose';
import { getShopifyAppCredentialsByShop } from '@/lib/db';

function shopDomain(dest: unknown): string {
  if (typeof dest !== 'string') throw new Error('Missing destination');
  const url = new URL(dest.includes('://') ? dest : `https://${dest}`);
  if (url.protocol !== 'https:' || url.username || url.password || url.port
      || url.pathname !== '/' || url.search || url.hash
      || !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(url.hostname)) throw new Error('Invalid destination');
  return url.hostname;
}
export async function verifyShopifySessionClaims(token: string) {
  // Untrusted claims select the candidate key only; nothing is authorized before jwtVerify.
  const shop = shopDomain(decodeJwt(token).dest);
  const credentials = await getShopifyAppCredentialsByShop(shop);
  const secret = credentials?.client_secret || process.env.SHOPIFY_API_SECRET;
  const audience = credentials?.client_id || process.env.SHOPIFY_API_KEY;
  if (!secret || !audience) throw new Error('Missing app credentials');
  const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
    algorithms: ['HS256'], audience, clockTolerance: 5,
    requiredClaims: ['dest', 'aud', 'exp', 'iat', 'nbf', 'jti'], maxTokenAge: '5m',
  });
  if (shopDomain(payload.dest) !== shop) throw new Error('Shop mismatch');
  // Checkout tokens may omit iss; App Bridge issuers must match the signed destination.
  if (payload.iss && payload.iss !== `https://${shop}/admin` && payload.iss !== `https://${shop}`) throw new Error('Invalid issuer');
  return { shop, customer: payload.sub };
}
export async function verifyShopifySessionToken(token: string): Promise<string> {
  return (await verifyShopifySessionClaims(token)).shop;
}
