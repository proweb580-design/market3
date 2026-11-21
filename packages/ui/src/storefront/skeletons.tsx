import { Skeleton } from '../components/ui/skeleton';

/** Loading states shown while route params / data resolve (Next 16 instant-navigation shells). */
export function PageSkeleton({ variant = 'grid' }: { variant?: 'grid' | 'product' }) {
  if (variant === 'product') {
    return (
      <div className="grid gap-10 px-page pt-8 md:grid-cols-12" aria-busy="true" aria-label="Загрузка">
        <Skeleton className="aspect-square md:col-span-7" />
        <div className="flex flex-col gap-3 md:col-span-4 md:col-start-9">
          <Skeleton className="h-3 w-1/2" />
          <Skeleton className="h-12 w-4/5" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="mt-6 h-8 w-full" />
          <Skeleton className="h-11 w-full" />
        </div>
      </div>
    );
  }
  return (
    <div className="px-page pt-10" aria-busy="true" aria-label="Загрузка">
      <Skeleton className="h-12 w-64" />
      <div className="mt-10 grid grid-cols-2 gap-4 md:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="aspect-[4/5]" />
        ))}
      </div>
    </div>
  );
}

export function ShellSkeleton() {
  return (
    <div aria-busy="true" aria-label="Загрузка магазина">
      <div className="h-header border-b border-border" />
      <PageSkeleton />
    </div>
  );
}
