import crypto from 'crypto';

function sanitizeCipherPaySecret(value: string): string {
  return value
    .trim()
    .replace(/[\s\u2028\u2029]+/g, '');
}

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
    amount: number;
    currency?: string;
    size?: string;
    return_url?: string;
    theme?: string;
  }
): Promise<CipherPayInvoice> {
  const normalizedApiUrl = apiUrl.trim().replace(/\/+$/, '');
  const normalizedApiKey = sanitizeCipherPaySecret(apiKey);
  const res = await fetch(`${normalizedApiUrl}/api/invoices`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${normalizedApiKey}`,
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
  const normalizedWebhookSecret = sanitizeCipherPaySecret(webhookSecret);
  const payload = `${timestamp}.${body}`;
  const computed = crypto
    .createHmac('sha256', normalizedWebhookSecret)
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
