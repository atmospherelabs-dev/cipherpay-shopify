import crypto from 'crypto';

export interface CipherPayInvoice {
  id: string;
  memo: string;
  payment_address: string;
  payment_uri: string;
  status: string;
  price_zec: number;
  price_eur: number | null;
  price_usd: number | null;
  expires_at: string;
}

export async function createInvoice(
  apiUrl: string,
  apiKey: string,
  params: {
    product_name: string;
    price_eur?: number;
    price_usd?: number;
    size?: string;
    return_url?: string;
    theme?: string;
    currency?: string;
  }
): Promise<CipherPayInvoice> {
  const res = await fetch(`${apiUrl}/api/invoices`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`CipherPay invoice creation failed: ${res.status} ${text}`);
  }

  return res.json();
}

export function verifyCipherPayWebhook(
  body: string,
  signature: string,
  timestamp: string,
  webhookSecret: string
): boolean {
  const payload = `${timestamp}.${body}`;
  const computed = crypto
    .createHmac('sha256', webhookSecret)
    .update(payload)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(computed),
      Buffer.from(signature)
    );
  } catch {
    return false;
  }
}
