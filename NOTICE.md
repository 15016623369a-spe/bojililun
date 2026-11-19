# NOTICE

## 3D 人体解剖模型（public/models/body.glb）

- 模型文件来自 [hpfrei/body-anatomy-3d-viewer](https://github.com/hpfrei/body-anatomy-3d-viewer)，
  由该项目的作者从 [Z-Anatomy](https://www.z-anatomy.com/) 数据集简化并做 DRACO 压缩而成
- 解剖数据版权：**Z-Anatomy**（CC BY-SA 4.0，基于 BodyParts3D / FMA 等开放解剖数据集）
- 模型文件（`public/models/body.glb`）及其在本项目中的衍生使用遵循 **CC BY-SA 4.0**：
  - 需保留署名：Z-Anatomy（https://www.z-anatomy.com/）与 hpfrei（https://github.com/hpfrei/body-anatomy-3d-viewer）
  - 若分发修改后的模型，需以相同许可（CC BY-SA 4.0）分发
  - 本项目的业务代码（训练记录、饮食、统计等）与模型资产相互独立；CC BY-SA 只覆盖模型资产本身
- 回顾页的正背面图层（`public/models/review-front.png`、`public/models/review-back.png`）由同一模型正交投影生成，调整了光照并编码训练部位，同样采用 CC BY-SA 4.0。
- 如需移除这些模型资产，删除 `public/models/body.glb` 和两张回顾图层。动作列表、筛选和训练记录仍可查看。

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

## 计划页矢量人体图（lib/body-map.json）

- 由 `public/models/review-front.png` / `review-back.png` 逐肌肉描摹成 SVG 路径（`scripts/trace-body-map.mjs`），
  与上面的 Z-Anatomy 模型同源，同样遵循 **CC BY-SA 4.0**，署名保留在应用内的动作数据说明处
- 路径坐标基于 420×960 的图集，按肌肉 ID 一一切片，点击时按 ID 直接命中

## 计划页运动人体模型

`public/models/athletes/` 包含以 MakeHuman CC0 人体及塑形资产制作的 FitCheck 男女模型。两款模型共享 39 个训练选区。原始资产许可随模型提供于 `public/models/athletes/LICENSE.md`。
