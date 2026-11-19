import type { Metadata } from 'next';
import { Roboto_Flex } from 'next/font/google';
import { ThemeScript } from '@repo/ui/storefront/theme-script';
import { AuthProvider } from './auth-provider';
import './globals.css';

// Variable width axis gives the wide, heavy grotesk headings of the reference; Cyrillic for RU content.
const font = Roboto_Flex({
  subsets: ['latin', 'cyrillic'],
  axes: ['wdth'],
  variable: '--font-roboto-flex',
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: 'Platform', template: '%s' },
  description: 'Storefronts for clothing brands — web and Telegram Mini App',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="ru" className={`${font.variable} h-full`} suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body className="min-h-full">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
