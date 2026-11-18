# NOTICE

## 动作数据与媒体

本项目的动作元数据、中文分步说明与 180×180 缩略图来自：

- **hasaneyldrm/exercises-dataset** — <https://github.com/hasaneyldrm/exercises-dataset>
  - 代码、数据集结构与说明文本：MIT License
  - 动作图片 / GIF：© [Gym visual](https://gymvisual.com/)，由数据集在 **180×180 分辨率**下经授权再分发

本仓库在 `public/exercises/` 中分发这些 180×180 缩略图，并保留署名。
**未包含原始 GIF**（详情页动图由 `/api/gif/[id]` 在首次访问时从上游仓库拉取并缓存在本地 `data/gifs/`）。

若你计划商用、去除 180×180 限制或修改媒体，请自行向 Gym visual 取得授权（<https://gymvisual.com/content/3-terms-and-conditions-of-use>）。
如不希望在本仓库分发媒体，可删除 `public/exercises/`，应用会自动降级为无图卡片。

## 食物营养数据

`lib/foods.ts` 中的每 100g 营养值为常见食物近似值，仅供演示，不构成营养建议。
正式产品建议接入《中国食物成分表》或商业营养数据库。

## 其他

- 图表、统计、训练记录均由本项目自身代码生成
- 微信接入相关说明见 README
