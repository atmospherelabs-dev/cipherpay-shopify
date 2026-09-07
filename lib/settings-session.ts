import { NextRequest, NextResponse } from 'next/server';
export const SETTINGS_COOKIE = '__Host-cipherpay-shop-session';
export function setSettingsSession(response: NextResponse, shop: string, token: string) {
  response.cookies.set(SETTINGS_COOKIE, Buffer.from(JSON.stringify({ shop, token })).toString('base64url'),
    { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 86400 });
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
}
export function readSettingsSession(req: NextRequest): { shop: string; token: string } | null {
  try {
    const data = JSON.parse(Buffer.from(req.cookies.get(SETTINGS_COOKIE)?.value || '', 'base64url').toString());
    if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(data.shop) || typeof data.token !== 'string') return null;
    return data;
  } catch { return null; }
}
