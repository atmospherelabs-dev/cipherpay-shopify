'use client';

import { useState } from 'react';

export default function InstallPage() {
  const [shop, setShop] = useState('');

  const handleInstall = (e: React.FormEvent) => {
    e.preventDefault();
    let shopDomain = shop.trim()
      .replace(/^https?:\/\//, '')
      .replace(/\/+$/, '');
    if (!shopDomain.includes('.')) {
      shopDomain = `${shopDomain}.myshopify.com`;
    }
    window.location.href = `/api/auth?shop=${encodeURIComponent(shopDomain)}`;
  };

  return (
    <div style={{ maxWidth: 480, margin: '80px auto', padding: '0 24px' }}>
      <div style={{
        border: '1px solid #27272a',
        borderRadius: 8,
        padding: 32,
        backgroundColor: '#0a0a0c',
      }}>
        <h1 style={{ fontSize: 20, marginTop: 0, marginBottom: 8 }}>
          <span style={{ color: '#00D4FF' }}>Cipher</span>Pay for Shopify
        </h1>
        <p style={{ color: '#71717a', fontSize: 13, marginBottom: 24, lineHeight: 1.6 }}>
          Accept shielded Zcash payments on your Shopify store.
          Non-custodial, private, instant detection.
        </p>

        <form onSubmit={handleInstall}>
          <label style={{ fontSize: 11, color: '#71717a', textTransform: 'uppercase', letterSpacing: 1 }}>
            Your Shopify Store
          </label>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <input
              type="text"
              placeholder="my-store.myshopify.com"
              value={shop}
              onChange={(e) => setShop(e.target.value)}
              required
              style={{
                flex: 1,
                padding: '10px 12px',
                backgroundColor: '#18181b',
                border: '1px solid #27272a',
                borderRadius: 4,
                color: '#e4e4e7',
                fontFamily: 'inherit',
                fontSize: 13,
                outline: 'none',
              }}
            />
            <button
              type="submit"
              style={{
                padding: '10px 20px',
                backgroundColor: '#00D4FF',
                color: '#09090b',
                border: 'none',
                borderRadius: 4,
                fontFamily: 'inherit',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              INSTALL
            </button>
          </div>
        </form>

        <div style={{ marginTop: 32, paddingTop: 24, borderTop: '1px solid #27272a' }}>
          <p style={{ fontSize: 11, color: '#52525b', margin: 0, lineHeight: 1.8 }}>
            After installation, configure your CipherPay API key in the app settings
            inside your Shopify admin panel.
          </p>
        </div>
      </div>

      <p style={{ textAlign: 'center', marginTop: 24, fontSize: 11, color: '#52525b' }}>
        <a href="https://cipherpay.app" target="_blank" rel="noopener noreferrer" style={{ color: '#00D4FF', textDecoration: 'none' }}>
          cipherpay.app
        </a>
        {' · '}
        <a href="https://cipherpay.app/docs" target="_blank" rel="noopener noreferrer" style={{ color: '#71717a', textDecoration: 'none' }}>
          Documentation
        </a>
      </p>
    </div>
  );
}
