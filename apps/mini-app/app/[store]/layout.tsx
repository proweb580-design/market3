import { StoreLayoutRoute, storeMetadata } from '@repo/ui/storefront/routes';
import { TelegramBridge } from '../telegram-bridge';

export const generateMetadata = ({ params }: LayoutProps<'/[store]'>) => storeMetadata(params);

export default function StoreLayout({ children, params }: LayoutProps<'/[store]'>) {
  return (
    <StoreLayoutRoute params={params} basePath={(s) => `/${s}`} variant="miniapp" extras={<TelegramBridge />}>
      {children}
    </StoreLayoutRoute>
  );
}
