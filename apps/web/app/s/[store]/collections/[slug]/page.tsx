import type { Metadata } from 'next';
import { CollectionRoute, collectionTitle } from '@repo/ui/storefront/routes';

export async function generateMetadata({ params }: PageProps<'/s/[store]/collections/[slug]'>): Promise<Metadata> {
  return { title: await collectionTitle(params) };
}

export default function CollectionPage({ params }: PageProps<'/s/[store]/collections/[slug]'>) {
  return <CollectionRoute params={params} />;
}
