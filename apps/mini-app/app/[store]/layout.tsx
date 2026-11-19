import { StoreLayoutRoute } from '@repo/ui/storefront/routes';
import { TelegramBridge } from '../telegram-bridge';

export default function StoreLayout({ children, params }: LayoutProps<'/[store]'>) {
  return (
    <StoreLayoutRoute params={params} basePath={(s) => `/${s}`} variant="miniapp" extras={<TelegramBridge />}>
      {children}
    </StoreLayoutRoute>
  );
}
