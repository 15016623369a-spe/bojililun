import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // node:sqlite 是 Node 内置模块，必须留在服务端运行时，不能被打包进客户端
  serverExternalPackages: ['node:sqlite'],
  // 本地用 127.0.0.1 / 局域网 IP 访问时避免 dev 跨域告警
  allowedDevOrigins: ['127.0.0.1', '192.168.1.156'],
  // 关掉左下角的 dev 指示器，它会压住拍照按钮
  devIndicators: false,
  webpack(config, { dev }) {
    if (dev) {
      // 忽略数据目录、PR 截图与非代码目录，减少开发期无谓重编与 Chunk 失效
      config.watchOptions = {
        ...config.watchOptions,
        ignored: ['**/node_modules/**', '**/node_modules 2/**', '**/data/**', '**/docs/pr/**'],
      };
    }
    return config;
  },
  // 不开客户端页面缓存（staleTimes）：这是记录类应用，练完一组、记一餐后用应用内导航回到别的页面，
  // 也必须看到最新数字。缓存 30 秒时，练完一组点「今日训练」回来会少了「训练进行中」横幅。
  async headers() {
    const immutableAsset = [{ key: 'Cache-Control', value: 'public, max-age=604800, stale-while-revalidate=86400' }];
    return [
      { source: '/models/:path*', headers: immutableAsset },
      { source: '/plan-poses/:path*', headers: immutableAsset },
      { source: '/draco/:path*', headers: immutableAsset },
      { source: '/exercises/:path*', headers: immutableAsset },
      { source: '/sculpture-exercises/:path*', headers: immutableAsset },
    ];
  },
};

export default nextConfig;
