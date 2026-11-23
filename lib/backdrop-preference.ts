/**
 * 回顾页和记录页的自定义背景（「我的」里更换）。图片存在上传目录，文件名和回顾页透明度存 cookie，
 * 根据 cookie 在服务端直接渲染，进页面不闪。前后端共用，这里不引服务端模块。
 */
export const BACKDROP_COOKIE = 'fc-backdrop';
export const GLASS_COOKIE = 'fc-glass';
/** 回顾页透明度默认 40%：数据块能透出背景，字仍然清楚 */
export const GLASS_DEFAULT = 40;

export function parseBackdrop(value: string | undefined | null) {
  return value && /^bg-\d+-[a-f0-9]{6}\.jpg$/.test(value) ? value : null;
}

export function parseGlass(value: string | undefined | null) {
  const n = Number(value);
  return value !== undefined && value !== null && value !== '' && Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : GLASS_DEFAULT;
}

export const backdropUrl = (name: string) => `/api/uploads/${name}`;
