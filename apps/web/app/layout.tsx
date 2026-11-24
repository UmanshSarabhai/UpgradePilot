import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { SiteHeader } from '@/components/site-header';
import { Providers } from './providers';
import './globals.css';

// globals.css maps --font-sans and --font-geist-mono into the Tailwind theme.
const geistSans = Geist({ variable: '--font-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'UpgradePilot',
  description: 'Dependency upgrade advisor for public GitHub repositories.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full bg-background antialiased`}>
      <body className="flex min-h-full flex-col bg-muted/30">
        <Providers>
          <SiteHeader />
          <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
