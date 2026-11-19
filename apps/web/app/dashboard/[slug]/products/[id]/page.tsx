'use client';

import { useParams } from 'next/navigation';
import { Async, PageHead, useLoad } from '../../../kit';
import { useOrg } from '../../../org-context';
import { ProductForm, type ProductDto } from '../product-form';

function Edit({ id }: { id: string }) {
  const org = useOrg();
  const product = useLoad<ProductDto>(`/organizations/${org.id}/products/${id}`);
  return (
    <Async state={product}>
      {(p) => (
        <>
          <PageHead title={p.title} />
          <ProductForm product={p} />
        </>
      )}
    </Async>
  );
}

/** `/products/new` creates; `/products/<id>` edits. */
export default function ProductPage() {
  const { id } = useParams<{ id: string }>();
  if (id === 'new') {
    return (
      <>
        <PageHead title="New product" />
        <ProductForm product={null} />
      </>
    );
  }
  return <Edit id={id} />;
}
