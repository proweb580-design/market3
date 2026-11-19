import Link from 'next/link';

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col justify-center gap-4 px-6">
      <p className="label-xs text-muted-foreground">Platform</p>
      <h1 className="title-xl text-5xl sm:text-7xl">Storefronts for clothing brands</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        Витрина бренда на сайте и в Telegram Mini App. Лендинг и тарифы платформы появятся на этапе 8.
      </p>
      <Link href="/s/ashen" className="label-xs mt-4 font-bold underline">
        Demo store →
      </Link>
      <Link href="/dashboard" className="label-xs font-bold underline">
        Brand dashboard →
      </Link>
      <Link href="/admin" className="label-xs font-bold underline">
        Platform admin →
      </Link>
      <Link href="/account" className="label-xs font-bold underline">
        My account →
      </Link>
    </main>
  );
}
