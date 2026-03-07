'use client';

import { useState, useEffect } from 'react';

interface ShopConfig {
  shop: string;
  cipherpay_api_key: string | null;
  cipherpay_api_url: string;
  cipherpay_webhook_secret: string | null;
  payment_url: string;
  webhook_url: string;
}

export default function SettingsPage() {
  const [shop, setShop] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [apiUrl, setApiUrl] = useState('https://api.cipherpay.app');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [paymentUrl, setPaymentUrl] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const shopParam = params.get('shop') || '';
    setShop(shopParam);

    if (shopParam) {
      fetch(`/api/settings?shop=${encodeURIComponent(shopParam)}`)
        .then(r => r.json())
        .then((data: ShopConfig) => {
          if (data.cipherpay_api_key) setApiKey(data.cipherpay_api_key);
          if (data.cipherpay_api_url) setApiUrl(data.cipherpay_api_url);
          if (data.cipherpay_webhook_secret) setWebhookSecret(data.cipherpay_webhook_secret);
          setPaymentUrl(data.payment_url || '');
          setWebhookUrl(data.webhook_url || '');
          setLoading(false);
        })
        .catch(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaved(false);
    setError('');

    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        shop,
        cipherpay_api_key: apiKey,
        cipherpay_api_url: apiUrl,
        cipherpay_webhook_secret: webhookSecret,
      }),
    });

    if (res.ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } else {
      setError('Failed to save settings');
    }
  };

  if (loading) {
    return (
      <div style={{ maxWidth: 560, margin: '80px auto', padding: '0 24px', color: '#71717a' }}>
        Loading...
      </div>
    );
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 12px',
    backgroundColor: '#18181b',
    border: '1px solid #27272a',
    borderRadius: 4,
    color: '#e4e4e7',
    fontFamily: 'inherit',
    fontSize: 13,
    outline: 'none',
    boxSizing: 'border-box',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 11,
    color: '#71717a',
    textTransform: 'uppercase',
    letterSpacing: 1,
    display: 'block',
    marginBottom: 6,
  };

  return (
    <div style={{ maxWidth: 560, margin: '80px auto', padding: '0 24px' }}>
      <div style={{
        border: '1px solid #27272a',
        borderRadius: 8,
        padding: 32,
        backgroundColor: '#0a0a0c',
      }}>
        <h1 style={{ fontSize: 18, marginTop: 0, marginBottom: 4 }}>
          <span style={{ color: '#00D4FF' }}>Cipher</span>Pay Settings
        </h1>
        <p style={{ color: '#52525b', fontSize: 12, marginBottom: 24 }}>
          {shop}
        </p>

        <form onSubmit={handleSave}>
          <div style={{ marginBottom: 20 }}>
            <label style={labelStyle}>CipherPay API Key</label>
            <input
              type="password"
              placeholder="cpay_..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              required
              style={inputStyle}
            />
            <p style={{ fontSize: 11, color: '#52525b', marginTop: 4, marginBottom: 0 }}>
              From your CipherPay merchant dashboard &gt; Settings &gt; API Keys
            </p>
          </div>

          <div style={{ marginBottom: 20 }}>
            <label style={labelStyle}>CipherPay Webhook Secret</label>
            <input
              type="password"
              placeholder="whsec_..."
              value={webhookSecret}
              onChange={(e) => setWebhookSecret(e.target.value)}
              required
              style={inputStyle}
            />
            <p style={{ fontSize: 11, color: '#52525b', marginTop: 4, marginBottom: 0 }}>
              From your CipherPay dashboard &gt; Settings &gt; Webhook Secret
            </p>
          </div>

          <div style={{ marginBottom: 20 }}>
            <label style={labelStyle}>CipherPay API URL</label>
            <input
              type="url"
              value={apiUrl}
              onChange={(e) => setApiUrl(e.target.value)}
              style={inputStyle}
            />
            <p style={{ fontSize: 11, color: '#52525b', marginTop: 4, marginBottom: 0 }}>
              Use https://api.testnet.cipherpay.app for testing
            </p>
          </div>

          <button
            type="submit"
            style={{
              padding: '10px 24px',
              backgroundColor: '#00D4FF',
              color: '#09090b',
              border: 'none',
              borderRadius: 4,
              fontFamily: 'inherit',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              width: '100%',
            }}
          >
            SAVE SETTINGS
          </button>

          {saved && <p style={{ color: '#22c55e', fontSize: 12, marginTop: 12, textAlign: 'center' }}>Settings saved</p>}
          {error && <p style={{ color: '#ef4444', fontSize: 12, marginTop: 12, textAlign: 'center' }}>{error}</p>}
        </form>

        <div style={{ marginTop: 32, paddingTop: 24, borderTop: '1px solid #27272a' }}>
          <h3 style={{ fontSize: 13, color: '#a1a1aa', marginTop: 0, marginBottom: 12 }}>Setup Instructions</h3>

          <div style={{ fontSize: 12, color: '#71717a', lineHeight: 1.8 }}>
            <p style={{ marginTop: 0 }}>
              <strong style={{ color: '#a1a1aa' }}>1.</strong> In your CipherPay dashboard, set your webhook URL to:
            </p>
            <code style={{
              display: 'block',
              padding: '8px 12px',
              backgroundColor: '#18181b',
              borderRadius: 4,
              fontSize: 11,
              color: '#00D4FF',
              marginBottom: 16,
              wordBreak: 'break-all',
            }}>
              {webhookUrl || `${typeof window !== 'undefined' ? window.location.origin : ''}/api/webhook/cipherpay`}
            </code>

            <p>
              <strong style={{ color: '#a1a1aa' }}>2.</strong> In your Shopify admin, go to <strong style={{ color: '#a1a1aa' }}>Settings → Payments → Manual payment methods</strong> and add a method called <strong style={{ color: '#a1a1aa' }}>Pay with Zcash (ZEC)</strong>.
            </p>

            <p>
              <strong style={{ color: '#a1a1aa' }}>3.</strong> In <strong style={{ color: '#a1a1aa' }}>Settings → Checkout → Additional scripts</strong>, paste:
            </p>
            <code style={{
              display: 'block',
              padding: '8px 12px',
              backgroundColor: '#18181b',
              borderRadius: 4,
              fontSize: 11,
              color: '#e4e4e7',
              marginBottom: 16,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}>
              {`<script src="${paymentUrl || (typeof window !== 'undefined' ? window.location.origin : '')}/checkout.js" data-shop="${shop}"></script>`}
            </code>

            <p style={{ marginBottom: 0 }}>
              <strong style={{ color: '#a1a1aa' }}>4.</strong> Place a test order to verify the payment flow.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
