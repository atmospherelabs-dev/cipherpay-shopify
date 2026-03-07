import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'CipherPay for Shopify',
  description: 'Accept shielded Zcash payments on your Shopify store',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{
        fontFamily: "'JetBrains Mono', 'SF Mono', 'Fira Code', monospace",
        backgroundColor: '#09090b',
        color: '#e4e4e7',
        margin: 0,
        padding: 0,
      }}>
        {children}
      </body>
    </html>
  );
}
