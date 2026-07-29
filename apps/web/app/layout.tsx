import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'CareerOS',
  description: 'Your career, run intentionally.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-bg-base text-text-primary antialiased">{children}</body>
    </html>
  );
}