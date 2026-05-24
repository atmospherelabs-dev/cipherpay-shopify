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

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      style={{
        padding: '4px 10px', fontSize: 10, fontWeight: 600, letterSpacing: 1,
        backgroundColor: copied ? '#22c55e' : 'transparent',
        color: copied ? '#000' : '#71717a',
        border: '1px solid #27272a', borderRadius: 4,
        cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s',
        whiteSpace: 'nowrap',
      }}
    >
      {copied ? 'COPIED' : 'COPY'}
    </button>
  );
}

export default function SettingsPage() {
  const [shop, setShop] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [apiUrl, setApiUrl] = useState('https://api.cipherpay.app');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [hasConfig, setHasConfig] = useState(false);
  const [authExpired, setAuthExpired] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const shopParam = params.get('shop') || '';
    setShop(shopParam);

    if (shopParam) {
      const allParams = new URLSearchParams(window.location.search).toString();
      fetch(`/api/settings?${allParams}`)
        .then(r => {
          if (r.status === 401) {
            setAuthExpired(true);
            setLoading(false);
            return null;
          }
          if (!r.ok) {
            setLoading(false);
            return null;
          }
          return r.json();
        })
        .then((data: ShopConfig | null) => {
          if (!data) return;
          if (data.cipherpay_api_key) setApiKey(data.cipherpay_api_key);
          if (data.cipherpay_api_url) setApiUrl(data.cipherpay_api_url);
          if (data.cipherpay_webhook_secret) setWebhookSecret(data.cipherpay_webhook_secret);
          setWebhookUrl(data.webhook_url || '');
          setHasConfig(!!(data.cipherpay_api_key && data.cipherpay_webhook_secret));
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

    const allParams = new URLSearchParams(window.location.search).toString();
    const res = await fetch(`/api/settings?${allParams}`, {
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
      setEditing(false);
      setHasConfig(true);
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

  const mask = (val: string) => {
    if (!val || val.length < 12) return val;
    return val.slice(0, 8) + '••••••••' + val.slice(-4);
  };

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

  const readOnlyFieldStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 12px',
    backgroundColor: '#18181b',
    border: '1px solid #27272a',
    borderRadius: 4,
    fontSize: 13,
    fontFamily: 'monospace',
    color: '#a1a1aa',
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

        {saved && <p style={{ color: '#22c55e', fontSize: 12, marginBottom: 16, textAlign: 'center' }}>Settings saved</p>}
        {error && <p style={{ color: '#ef4444', fontSize: 12, marginBottom: 16, textAlign: 'center' }}>{error}</p>}

        {authExpired ? (
          <div style={{
            padding: '14px 16px',
            border: '1px solid rgba(91,156,246,0.2)',
            borderRadius: 6,
            background: 'rgba(91,156,246,0.04)',
          }}>
            <p style={{ color: '#a1a1aa', fontSize: 12, margin: 0, lineHeight: 1.6 }}>
              <strong style={{ color: '#5B9CF6' }}>Session expired.</strong> Your CipherPay integration is still active.
              To view or edit settings, reinstall the app from your Shopify Partner dashboard to get a fresh session link.
            </p>
          </div>
        ) : hasConfig ? (
          <>
            {/* Status */}
            <div style={{
              padding: '14px 16px',
              border: '1px solid rgba(34,197,94,0.2)',
              borderRadius: 6,
              background: 'rgba(34,197,94,0.04)',
              marginBottom: 28,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                <span style={{ color: '#22c55e', fontSize: 14 }}>&#10003;</span>
                <span style={{ color: '#22c55e', fontSize: 13, fontWeight: 600 }}>Connected</span>
              </div>
              <p style={{ color: '#71717a', fontSize: 11, margin: '4px 0 0 22px', lineHeight: 1.5 }}>
                CipherPay API credentials are configured for this store. Payments will be processed automatically.
              </p>
            </div>

            {/* Remaining steps */}
            <div style={{ marginBottom: 28 }}>
              <h3 style={{ fontSize: 13, color: '#a1a1aa', marginTop: 0, marginBottom: 14 }}>Finish Shopify Setup</h3>
              <div style={{ fontSize: 12, color: '#71717a', lineHeight: 1.8 }}>
                <p style={{ marginTop: 0 }}>
                  <strong style={{ color: '#a1a1aa' }}>1.</strong> In Shopify admin, go to <strong style={{ color: '#a1a1aa' }}>Settings &rarr; Payments &rarr; Manual payment methods</strong> and create:
                </p>
                <code style={{
                  display: 'block', padding: '8px 12px', marginBottom: 16,
                  backgroundColor: '#18181b', borderRadius: 4,
                  fontSize: 11, color: '#00D4FF',
                }}>
                  Pay with Zcash (ZEC)
                </code>
                <p>
                  <strong style={{ color: '#a1a1aa' }}>2.</strong> Go to <strong style={{ color: '#a1a1aa' }}>Settings &rarr; Checkout &rarr; Customize</strong>, switch to the <strong style={{ color: '#a1a1aa' }}>Thank you</strong> page, and add the <strong style={{ color: '#00D4FF' }}>CipherPay Checkout</strong> app block.
                </p>
                <p style={{ marginBottom: 0 }}>
                  <strong style={{ color: '#a1a1aa' }}>3.</strong> Place a test order to verify. Customers select <strong style={{ color: '#a1a1aa' }}>Pay with Zcash (ZEC)</strong>, then click <strong style={{ color: '#00D4FF' }}>Pay with CipherPay</strong> on the Thank You page.
                </p>
              </div>
            </div>

            {/* Advanced — collapsed by default */}
            <div style={{ borderTop: '1px solid #1a1a1e', paddingTop: 16 }}>
              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                style={{
                  background: 'none', border: 'none', color: '#52525b',
                  fontSize: 10, fontFamily: 'inherit', cursor: 'pointer',
                  letterSpacing: 0.5, padding: 0,
                }}
              >
                {showAdvanced ? '▾ Hide advanced' : '▸ Advanced settings'}
              </button>

              {showAdvanced && (
                <div style={{ marginTop: 16 }}>
                  {editing ? (
                    <form onSubmit={handleSave}>
                      <div style={{ marginBottom: 16 }}>
                        <label style={labelStyle}>CipherPay API Key</label>
                        <input type="password" placeholder="cpay_..." value={apiKey} onChange={(e) => setApiKey(e.target.value)} required style={inputStyle} />
                      </div>
                      <div style={{ marginBottom: 16 }}>
                        <label style={labelStyle}>CipherPay Webhook Secret</label>
                        <input type="password" placeholder="whsec_..." value={webhookSecret} onChange={(e) => setWebhookSecret(e.target.value)} required style={inputStyle} />
                      </div>
                      <div style={{ marginBottom: 16 }}>
                        <label style={labelStyle}>CipherPay API URL</label>
                        <input type="url" value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} style={inputStyle} />
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button type="submit" style={{
                          padding: '8px 20px', backgroundColor: '#00D4FF', color: '#09090b',
                          border: 'none', borderRadius: 4, fontFamily: 'inherit',
                          fontSize: 11, fontWeight: 600, cursor: 'pointer', flex: 1,
                        }}>
                          SAVE
                        </button>
                        <button type="button" onClick={() => setEditing(false)} style={{
                          padding: '8px 20px', backgroundColor: 'transparent', color: '#71717a',
                          border: '1px solid #27272a', borderRadius: 4, fontFamily: 'inherit',
                          fontSize: 11, fontWeight: 600, cursor: 'pointer',
                        }}>
                          CANCEL
                        </button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <div style={{ marginBottom: 14 }}>
                        <label style={labelStyle}>CipherPay API Key</label>
                        <div style={readOnlyFieldStyle}>
                          <span>{mask(apiKey)}</span>
                          <CopyBtn text={apiKey} />
                        </div>
                      </div>
                      <div style={{ marginBottom: 14 }}>
                        <label style={labelStyle}>CipherPay Webhook Secret</label>
                        <div style={readOnlyFieldStyle}>
                          <span>{mask(webhookSecret)}</span>
                          <CopyBtn text={webhookSecret} />
                        </div>
                      </div>
                      <div style={{ marginBottom: 14 }}>
                        <label style={labelStyle}>CipherPay API URL</label>
                        <div style={readOnlyFieldStyle}>
                          <span style={{ color: '#00D4FF' }}>{apiUrl}</span>
                          <CopyBtn text={apiUrl} />
                        </div>
                      </div>
                      <div style={{ marginBottom: 14 }}>
                        <label style={labelStyle}>Webhook Endpoint</label>
                        <div style={readOnlyFieldStyle}>
                          <span style={{ color: '#71717a', fontSize: 11 }}>
                            {webhookUrl || `${typeof window !== 'undefined' ? window.location.origin : ''}/api/webhook/cipherpay`}
                          </span>
                        </div>
                      </div>
                      <button type="button" onClick={() => setEditing(true)} style={{
                        padding: '8px 20px', backgroundColor: 'transparent', color: '#52525b',
                        border: '1px solid #1a1a1e', borderRadius: 4, fontFamily: 'inherit',
                        fontSize: 10, fontWeight: 600, cursor: 'pointer',
                      }}>
                        EDIT
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </>
        ) : (
          /* No config — show the full form for manual setup */
          <div>
            <div style={{
              padding: '14px 16px',
              border: '1px solid rgba(239,68,68,0.2)',
              borderRadius: 6,
              background: 'rgba(239,68,68,0.04)',
              marginBottom: 24,
            }}>
              <p style={{ color: '#71717a', fontSize: 11, margin: 0, lineHeight: 1.5 }}>
                CipherPay credentials are not configured yet. If you set up from the
                <strong style={{ color: '#a1a1aa' }}> CipherPay dashboard</strong>,
                they should appear automatically after installation. Otherwise, fill them in manually below.
              </p>
            </div>
            <form onSubmit={handleSave}>
              <div style={{ marginBottom: 20 }}>
                <label style={labelStyle}>CipherPay API Key</label>
                <input type="password" placeholder="cpay_..." value={apiKey} onChange={(e) => setApiKey(e.target.value)} required style={inputStyle} />
                <p style={{ fontSize: 11, color: '#52525b', marginTop: 4, marginBottom: 0 }}>
                  From your CipherPay merchant dashboard &gt; Settings &gt; API Keys
                </p>
              </div>
              <div style={{ marginBottom: 20 }}>
                <label style={labelStyle}>CipherPay Webhook Secret</label>
                <input type="password" placeholder="whsec_..." value={webhookSecret} onChange={(e) => setWebhookSecret(e.target.value)} required style={inputStyle} />
                <p style={{ fontSize: 11, color: '#52525b', marginTop: 4, marginBottom: 0 }}>
                  From your CipherPay dashboard &gt; Settings &gt; Webhook Secret
                </p>
              </div>
              <div style={{ marginBottom: 20 }}>
                <label style={labelStyle}>CipherPay API URL</label>
                <input type="url" value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} style={inputStyle} />
                <p style={{ fontSize: 11, color: '#52525b', marginTop: 4, marginBottom: 0 }}>
                  Use https://api.testnet.cipherpay.app for testing
                </p>
              </div>
              <button type="submit" style={{
                padding: '10px 24px', backgroundColor: '#00D4FF', color: '#09090b',
                border: 'none', borderRadius: 4, fontFamily: 'inherit',
                fontSize: 13, fontWeight: 600, cursor: 'pointer', width: '100%',
              }}>
                SAVE SETTINGS
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
