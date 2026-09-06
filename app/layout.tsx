import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Pulse - Write it down and scan it',
  description: 'Photograph a handwritten stock list and have it counted into inventory.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Without this, env(safe-area-inset-*) is always 0 and anything anchored to the
  // bottom of the screen ends up under the home indicator or the browser's own toolbar.
  viewportFit: 'cover',
  themeColor: '#9c2fa7',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Nata Sans is the Pulse typeface. Loaded by <link> rather than next/font so a
            blocked font host degrades to the system stack instead of failing the build. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font -- that rule targets
            the Pages Router's _document; in the App Router this <head> is the shared one. */}
        <link
          href="https://fonts.googleapis.com/css2?family=Nata+Sans:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
