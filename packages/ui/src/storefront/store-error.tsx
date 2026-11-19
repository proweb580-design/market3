'use client';

import { Button } from '../components/ui/button';

/** Shown when the storefront API can't be reached (or errors); the user can retry without reloading the app. */
export function StoreError({ reset }: { reset: () => void }) {
  return (
    <div role="alert" className="flex min-h-[60svh] flex-col items-center justify-center gap-4 px-page text-center">
      <p className="label-xs text-muted-foreground">Store unavailable</p>
      <h1 className="title-xl text-4xl">Something went wrong</h1>
      <p className="max-w-sm text-xs text-muted-foreground">We couldn’t load this store right now. Please try again in a moment.</p>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
