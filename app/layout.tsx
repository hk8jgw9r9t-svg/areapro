import type { Metadata, Viewport } from 'next';
import '../src/ui/styles.css';

export const metadata: Metadata = {
  title: 'AreaPro – D2D Sales',
  description: 'Adressqualifizierung & Potenzialmanagement für den Door-to-Door-Vertrieb',
  manifest: '/manifest.webmanifest',
  applicationName: 'AreaPro',
  appleWebApp: { capable: true, title: 'AreaPro', statusBarStyle: 'default' },
  icons: { icon: '/icons/icon-192.png', apple: '/icons/apple-touch-icon.png' },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0f766e',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
