import { cookies } from 'next/headers';
import { BACKDROP_COOKIE, GLASS_COOKIE, backdropUrl, parseBackdrop, parseGlass } from '../backdrop-preference';

/** 回顾、记录页的背景：没设置时返回 null，页面照旧是冷银灰 */
export async function readBackdrop() {
  const jar = await cookies();
  const name = parseBackdrop(jar.get(BACKDROP_COOKIE)?.value);
  return name ? { url: backdropUrl(name), glass: parseGlass(jar.get(GLASS_COOKIE)?.value) } : null;
}

/** 「我的」里的设置面板要知道当前状态，没有背景也要读透明度 */
export async function readBackdropSettings() {
  const jar = await cookies();
  const name = parseBackdrop(jar.get(BACKDROP_COOKIE)?.value);
  return { url: name ? backdropUrl(name) : null, glass: parseGlass(jar.get(GLASS_COOKIE)?.value) };
}
