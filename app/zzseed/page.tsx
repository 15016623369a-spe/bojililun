import { notFound } from 'next/navigation';
import SeedEditor from './SeedEditor';

/** 雕塑肌群分区工具：只在开发时打开，正式版返回 404 */
export default function Page() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <SeedEditor />;
}
