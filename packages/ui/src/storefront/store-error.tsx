'use client';

import { Button } from '../components/ui/button';

/** Shown when the storefront API can't be reached (or errors); the user can retry without reloading the app. */
export function StoreError({ reset }: { reset: () => void }) {
  return (
    <div role="alert" className="flex min-h-[60svh] flex-col items-center justify-center gap-4 px-page text-center">
      <p className="label-xs text-muted-foreground">Магазин недоступен</p>
      <h1 className="title-xl text-4xl">Что-то пошло не так</h1>
      <p className="max-w-sm text-xs text-muted-foreground">Не удалось загрузить магазин. Попробуйте чуть позже.</p>
      <Button onClick={reset}>Попробовать снова</Button>
    </div>
  );
}
