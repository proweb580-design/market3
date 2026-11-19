'use client';

import { StoreError } from '@repo/ui/storefront/store-error';

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <StoreError reset={reset} />;
}
