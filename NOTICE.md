# NOTICE

## 3D 人体解剖模型（public/models/body.glb）

- 模型文件来自 [hpfrei/body-anatomy-3d-viewer](https://github.com/hpfrei/body-anatomy-3d-viewer)，
  由该项目的作者从 [Z-Anatomy](https://www.z-anatomy.com/) 数据集简化并做 DRACO 压缩而成
- 解剖数据版权：**Z-Anatomy**（CC BY-SA 4.0，基于 BodyParts3D / FMA 等开放解剖数据集）
- 模型文件（`public/models/body.glb`）及其在本项目中的衍生使用遵循 **CC BY-SA 4.0**：
  - 需保留署名：Z-Anatomy（https://www.z-anatomy.com/）与 hpfrei（https://github.com/hpfrei/body-anatomy-3d-viewer）
  - 若分发修改后的模型，需以相同许可（CC BY-SA 4.0）分发
  - 本项目的业务代码（训练记录、饮食、统计等）与模型资产相互独立；CC BY-SA 只覆盖模型资产本身
- 如不希望引入该许可，可删除 `public/models/body.glb`，`/body` 页会提示加载失败，但肌肉列表与动作筛选仍可用

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

## 中文动作名

动作的英文原名与中文分步说明来自上游数据集；**中文动作名是本项目生成的**（`scripts/translate-exercises.mjs`：
短语优先 + 逐词词典 + 人工修正），属于演绎内容，按 MIT 使用。如发现译名不准确，改脚本里的词典或
`MANUAL` 表后重新运行即可，`data/exercise-zh.json` 会在下次启动时同步进数据库。

## 其他

- 图表、统计、训练记录均由本项目自身代码生成
- 微信接入相关说明见 README
