import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'GiftGuard — Tidepath',
  description: 'A simpler weekly donor review for Tidepath Family Alliance.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
