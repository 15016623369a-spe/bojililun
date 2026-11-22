import { redirect } from 'next/navigation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function AtlasPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const legacy = new URLSearchParams();
  for (const key of ['muscle', 'library', 'body']) {
    const value = query[key];
    if (typeof value === 'string' && value) legacy.set(key, value);
  }
  redirect(legacy.size ? `/body?${legacy}` : '/train');
}
