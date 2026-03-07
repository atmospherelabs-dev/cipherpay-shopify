import crypto from 'crypto';

function sanitizeCipherPaySecret(value: string): string {
  return value
    .trim()
    .replace(/[\s\u2028\u2029]+/g, '');
}

export interface CipherPayInvoice {
  id: string;
  memo_code: string;
  payment_address: string;
  zcash_uri: string;
  price_zec: number;
  price_eur: number;
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

  const data = await res.json();
  const id = data?.id ?? data?.invoice_id;

  if (!id) {
    throw new Error(`CipherPay invoice response missing invoice id: ${JSON.stringify(data)}`);
  }

  return {
    id,
    memo_code: data.memo_code,
    payment_address: data.payment_address,
    zcash_uri: data.zcash_uri ?? data.payment_uri,
    price_zec: data.price_zec,
    price_eur: data.price_eur,
    price_usd: data.price_usd ?? null,
    expires_at: data.expires_at,
  };
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
