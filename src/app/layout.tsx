import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from '@/components/theme-provider';

export const metadata: Metadata = {
  title: {
    default: 'Clarift',
    template: '%s | Clarift',
  },
  description: 'Clarify, refine, and elevate prompts for better AI results.',
  applicationName: 'Clarift',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/brand/clarift-icon-dark.svg', type: 'image/svg+xml', media: '(prefers-color-scheme: light)' },
      { url: '/brand/clarift-icon-light.svg', type: 'image/svg+xml', media: '(prefers-color-scheme: dark)' },
    ],
  },
  openGraph: {
    title: 'Clarift',
    description: 'Clarify, refine, and elevate prompts for better AI results.',
    siteName: 'Clarift',
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'Clarift',
    description: 'Clarify, refine, and elevate prompts for better AI results.',
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#FFFFFF' },
    { media: '(prefers-color-scheme: dark)', color: '#1C1C1E' },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
        <link href="https://fonts.googleapis.com/css2?family=Source+Code+Pro&display=swap" rel="stylesheet" />
      </head>
      <body className="font-body antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <div className="relative z-10">
            {children}
          </div>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
