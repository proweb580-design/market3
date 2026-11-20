import Link from 'next/link';
import type { ReactNode } from 'react';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center px-6 py-16">
      <Link href="/" className="label-xs mb-10 text-muted-foreground hover:text-foreground">
        ← Back to store
      </Link>
      {children}
    </main>
  );
}
