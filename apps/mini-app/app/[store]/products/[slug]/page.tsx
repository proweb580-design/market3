import type { Metadata } from 'next';
import { ProductRoute, productTitle } from '@repo/ui/storefront/routes';

export async function generateMetadata({ params }: PageProps<'/[store]/products/[slug]'>): Promise<Metadata> {
  return { title: await productTitle(params) };
}

export default function ProductPage({ params }: PageProps<'/[store]/products/[slug]'>) {
  return <ProductRoute params={params} />;
}
