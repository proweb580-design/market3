import type { Metadata } from 'next';
import { OrderRoute } from '@repo/ui/storefront/routes';

export const metadata: Metadata = { title: 'Your order', robots: { index: false } };

export default function OrderPage({ params }: PageProps<'/s/[store]/orders/[orderId]'>) {
  return <OrderRoute params={params} />;
}
