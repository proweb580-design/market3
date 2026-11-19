import { StoreLayoutRoute } from '@repo/ui/storefront/routes';
import { WebStoreHost } from '../store-host';

export default function StoreLayout({ children, params }: LayoutProps<'/s/[store]'>) {
  return (
    <StoreLayoutRoute params={params} basePath={(s) => `/s/${s}`} variant="web" extras={<WebStoreHost />}>
      {children}
    </StoreLayoutRoute>
  );
}
