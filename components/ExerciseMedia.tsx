'use client';

import { useState } from 'react';

/**
 * 先请求 /api/gif/[id]（首次访问时服务端会去拉取并缓存 GIF），
 * 失败则回落到静态缩略图，保证任何网络状况下都有图。
 */
export default function ExerciseMedia({
  id,
  image,
  name,
}: {
  id: string;
  image: string;
  name: string;
}) {
  const [src, setSrc] = useState(`/api/gif/${id}`);
  const [animated, setAnimated] = useState(true);

  return (
    <div className="detail-media">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={name}
        onError={() => {
          if (animated) {
            setAnimated(false);
            setSrc(image);
          }
        }}
      />
      <span className="media-tag">{animated ? '动图' : '静图'}</span>
    </div>
  );
}
