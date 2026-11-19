'use client';

import { useState } from 'react';
import { cn } from '../lib/utils';
import { PanelView } from './media';
import { useStore } from './store-context';

/** Reference §2.9: eyebrow + title, tag filter tabs, three-column masonry with captions. */
export function LookbookView() {
  const { store } = useStore();
  // The route returns 404 when the store has no lookbook.
  const lookbook = store.lookbook!;
  const tags = ['All', ...new Set(lookbook.items.map((i) => i.tag))];
  const [tag, setTag] = useState('All');
  const items = tag === 'All' ? lookbook.items : lookbook.items.filter((i) => i.tag === tag);

  return (
    <div className="px-page pt-10">
      <p className="label-xs text-muted-foreground">Lookbook</p>
      <h1 className="title-xl mt-1 text-4xl sm:text-6xl">{lookbook.title}</h1>
      <p className="mt-2 text-xs text-muted-foreground">{lookbook.subtitle}</p>
      <div className="mt-6 flex flex-wrap gap-5 border-b border-border pb-3" role="tablist" aria-label="Filter looks">
        {tags.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tag === t}
            onClick={() => setTag(t)}
            className={cn('label-xs pb-1', tag === t ? 'border-b border-foreground font-bold' : 'text-muted-foreground hover:text-foreground')}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="mt-8 gap-4 sm:columns-2 lg:columns-3">
        {items.map((item, idx) => (
          <figure key={item.id} className="mb-6 break-inside-avoid animate-in fade-in duration-500">
            <div className="overflow-hidden rounded-sm" style={{ aspectRatio: `1 / ${item.ratio}` }}>
              <PanelView panel={item.panel} />
            </div>
            <figcaption className="mt-2 grid grid-cols-[auto_1fr] gap-x-3">
              <span className="label-xs tabular-nums text-muted-foreground">{String(idx + 1).padStart(2, '0')}</span>
              <span className="label-xs font-bold">{item.title}</span>
              <span className="label-xs text-muted-foreground">{item.tag}</span>
              <span className="label-xs text-muted-foreground">{item.caption}</span>
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}
