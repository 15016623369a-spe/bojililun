# PR #5 视觉对照

以当前分支上一版 `84853d4` 为改前基线。截图来自实际运行页面，使用同一个演示库，视口 390 × 844，DPR 2。点选状态用胸部验证。

| 场景 | 改动前 | 改动后 |
| --- | --- | --- |
| 手账「计划」入口 `/atlas` | [实体模型和旧控制条](before/atlas.png) | [点阵人体和柠檬黄锚点](after/atlas.png) |
| 计划页 `/body` | [实体模型](before/body.png) | [统一的点阵计划页](after/body.png) |
| 点选胸部 | [直接进入旧动作列表](before/atlas-library.png) | [灰白石膏姿势和部位概览抽屉](after/atlas-pose.png) |
| 打开动作库 | [旧动作列表](before/atlas-library.png) | [带勾选圈的多选抽屉](after/atlas-library.png) |
| 转身 | [旧首屏上的正背面控件](before/atlas.png) | [转到背面后遮挡的提示点隐藏](after/atlas-back.png) |
| 记录 | [上一版手账](before/log.png) | [统一计划、记录、回顾导航](after/log.png) |
| 回顾 | [上一版回顾](before/review.png) | [统一导航和回顾主题](after/review.png) |

计划页直接使用 PR #5 的渲染组件、抽屉和姿势素材。主导航的记录和回顾继续走手账路由 `/log` 和 `/review`，并保留记录键的长按功能。
