# Changelog

本项目的版本记录。版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.1.0] - 2026-11-18

首个可用版本：五模块网页版 + 真实解剖 3D 人体 + 语音对话 + 全中文动作库。

### 新增

- **训练**：今日训练清单（组数/次数/重量/组间休息可改）、逐组计时、休息倒计时、自动进组、练完归档
- **人体**：真实解剖 3D 模型（Z-Anatomy 数据，440 块肌肉网格，DRACO 压缩 8.2MB）
  - 胸部分上/中/下（Clavicular / Sternocostal / Abdominal head）
  - 肩部分前/中/后束，共 22 个可点肌束
  - 点肌肉 → 整块高亮 + 弹出该肌束动作，支持 `/body?muscle=chest_upper` 深链
- **动作库**：1,324 个动作，全中文名，部位 × 器械筛选、搜索、动图详情、一键加入今日训练
- **统计**：周 / 月 / 季 / 年，容量、次数、天数、时长、组数、肌群分布、容量趋势、动作表现
- **历史**：月历 + 每日详情（每组记录、当日计划、饮食）
- **对话**：文字 + 浏览器语音输入 / 语音播报；可以让教练直接排计划写进今日清单
- **饮食**：拍照或文字记餐 → 卡片确认 → 热量与蛋白质预算
- **记忆层**：约束 / 目标 / 器械 / 偏好四类，用户确认后长期生效，可随时增删

### 技术

- Next.js 15 + React 19 + Three.js + SQLite（`node:sqlite`，零外部数据库依赖）
- AI 层可切换：默认 mock（零 API Key 可跑），配置 OpenAI 兼容接口后解锁真实多模态识图
- 全站中文，动作名由 `scripts/translate-exercises.mjs` 生成（覆盖率 100%）

### 已知限制

- 食物拍照识别默认是演示模式，未接入视觉模型时不会真的识别照片
- 3D 模型 8.2MB，首屏加载 1–3 秒（有加载提示，之后走浏览器缓存）
- 语音识别依赖浏览器 Web Speech API（Chrome / Safari）
- 训练时「口述训练内容自动入库」尚未实现，当前归档走训练执行页

### 数据来源与许可

- 动作数据：[hasaneyldrm/exercises-dataset](https://github.com/hasaneyldrm/exercises-dataset)（MIT），媒体 © Gym visual（180×180）
- 3D 人体模型：[Z-Anatomy](https://www.z-anatomy.com/) / [hpfrei/body-anatomy-3d-viewer](https://github.com/hpfrei/body-anatomy-3d-viewer)（CC BY-SA 4.0）
- 详见 [NOTICE.md](NOTICE.md)
