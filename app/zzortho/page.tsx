import { notFound } from 'next/navigation';
import OrthoViews from './OrthoViews';

/** 雕塑正交底图导出工具：只在开发时打开，正式版返回 404 */
export default function Page() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <OrthoViews />;
}
