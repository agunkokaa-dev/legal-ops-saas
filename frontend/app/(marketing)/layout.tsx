import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { WAFloatingButton } from '@/components/support/WAFloatingButton';

export const metadata: Metadata = {
  title: {
    default: 'clause.id — AI-Native Contract Intelligence for Indonesia',
    template: '%s | clause.id',
  },
  description:
    'Review contracts, negotiate with evidence, and manage legal execution — in one AI-native workspace built for Indonesian legal teams.',
  keywords: [
    'contract management Indonesia',
    'AI contract review',
    'CLM Indonesia',
    'legal AI Indonesia',
    'contract lifecycle management',
    'UU PDP compliance',
    'negotiation AI',
  ],
  authors: [{ name: 'clause.id' }],
  creator: 'clause.id',
  metadataBase: new URL('https://clause.id'),
  openGraph: {
    type: 'website',
    locale: 'id_ID',
    alternateLocale: 'en_US',
    url: 'https://clause.id',
    siteName: 'clause.id',
    title: 'clause.id — AI-Native Contract Intelligence for Indonesia',
    description:
      'Review contracts, negotiate with evidence, and manage legal execution in one AI-native workspace.',
    images: [
      {
        url: '/logo-clause.png',
        width: 1200,
        height: 630,
        alt: 'clause.id — AI-Native CLM for Indonesia',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'clause.id — AI-Native Contract Intelligence for Indonesia',
    description: 'AI-native CLM built for Indonesian legal teams.',
    images: ['/logo-clause.png'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true },
  },
  icons: {
    icon: '/favicon.ico',
    shortcut: '/favicon.ico',
    apple: '/apple-icon.png',
  },
};

export const viewport: Viewport = {
  themeColor: '#08090b',
  width: 'device-width',
  initialScale: 1,
};

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'clause.id',
  applicationCategory: 'BusinessApplication',
  operatingSystem: 'Web',
  description:
    'AI-native contract intelligence workspace for Indonesian legal teams.',
  url: 'https://clause.id',
  publisher: {
    '@type': 'Organization',
    name: 'clause.id',
    url: 'https://clause.id',
  },
};

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="h-screen w-screen overflow-y-auto bg-[#08090b]">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      {children}
      <WAFloatingButton
        message="Halo, saya ingin tahu lebih lanjut tentang clause.id"
        position="bottom-right"
        showLabel={true}
      />
    </div>
  );
}
