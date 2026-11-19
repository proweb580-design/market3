import { StoreLayoutRoute } from '@repo/ui/storefront/routes';

export default function StoreLayout({ children, params }: LayoutProps<'/s/[store]'>) {
  return (
    <StoreLayoutRoute params={params} basePath={(s) => `/s/${s}`} variant="web">
      {children}
    </StoreLayoutRoute>
  );
}
