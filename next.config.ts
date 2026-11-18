import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // node:sqlite 是 Node 内置模块，必须留在服务端运行时，不能被打包进客户端
  serverExternalPackages: ['node:sqlite'],
  // 本地用 127.0.0.1 访问时避免 dev 跨域告警
  allowedDevOrigins: ['127.0.0.1'],
  // 关掉左下角的 dev 指示器，它会压住拍照按钮
  devIndicators: false,
};

export default nextConfig;
