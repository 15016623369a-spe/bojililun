# FitCheck · 会说话、会记计划的健身 Agent

一句话：**用嘴说今天练什么，它给你排计划；训练时一组一组点，自动计时和组间休息；练完自动进档案，统计和历史都在这。** 吃饭拍张照就完事。

当前是 Phase 1：**五模块网页版**（训练 / 统计 / 动作 / 历史 / 我的）+ 语音对话 + 完整训练记录链路。不需要任何 API Key 就能跑，食物识别默认走演示模式。

---

## 五个模块

| 模块 | 能干什么 |
| --- | --- |
| **训练** | 今日训练清单（组数/次数/重量/休息可改）、开始训练、今日热量与蛋白进度 |
| **统计** | 周 / 月 / 季 / 年：训练容量、次数、天数、时长、组数、肌群分布、容量趋势、动作表现 |
| **动作** | 1,324 个动作按「部位 × 器械」浏览 / 搜索，卡片上一键加进今日清单，详情页有动图 + 中文分步 |
| **历史** | 月历 + 每日详情（训练每组记录、饮食、当日计划） |
| **我的** | 资料与目标推算、记忆管理、数据概览、模型状态 |

右下角绿色按钮进入**对话**：可以打字、可以**按住麦克风说话**，回复会语音播报。

| 训练清单 | 训练执行 | 统计 |
| --- | --- | --- |
| ![清单](docs/shots/12-today-plan.png) | ![训练中](docs/shots/15-runner-rest.png) | ![统计](docs/shots/18-stats.png) |

| 历史月历 | 动作库 | 对话 / 语音 |
| --- | --- | --- |
| ![历史](docs/shots/17-history-calendar.png) | ![动作库](docs/shots/07-library.png) | ![对话](docs/shots/20-chat-voice.png) |

---

## 训练链路（核心）

```
动作库/对话 → 今日训练清单 → 开始训练（session）
   → 每个动作：开始本组（计时）→ 结束本组（记重量×次数）→ 组间休息倒计时
   → 自动进入下一组 / 下一个动作 → 完成并保存
   → 历史 & 统计 自动汇总
```

- 组间休息默认 90s，可在清单里或训练中随时改成 60 / 90 / 120 / 180s
- 休息页有「+15s」「跳过休息」
- 容量统一按 `重量 × 次数` 累加，自重动作按 0kg 计（只算组数和次数）
- 没练完就退出？训练页顶部会显示「有一节训练还没结束 · 继续训练」

对话里说 **「帮我安排今天练腿的动作，加进训练清单」**，它会按你记忆里的器械条件筛好动作、直接写进今日清单。

---

## 语音对话

- **语音输入**：Chrome / Safari 的 Web Speech API（`zh-CN`），说完自动发送
- **语音播报**：右上角「播报」开关控制，用系统 TTS 读回复
- 浏览器不支持时会给明确提示，打字照常可用

> 语音识别走浏览器自带的识别服务，不上传、不需要 Key。要更强的识别（口音、嘈杂环境），可以把 `/api/transcribe` 接上 Whisper 或国内 ASR。

---

## 快速开始

```bash
cd fitness-agent
npm install
npm run dev
# 打开 http://127.0.0.1:3001 （会跳到 /train，先填资料）
```

首次启动自动建表、灌入 35 条食物和 1,324 个动作（`data/fitness.db`）。

### 接上真实模型

复制 `.env.example` 为 `.env.local`：

```bash
AI_PROVIDER=openai
AI_BASE_URL=https://api.openai.com/v1
AI_API_KEY=sk-...
AI_MODEL=gpt-4o-mini
```

通义（dashscope compatible-mode）、豆包（ark）、DeepSeek 等只要是 `/chat/completions` + `image_url` 格式都能用。接上后拍照才会真的识别；训练、统计、历史不依赖模型，一直是真的。

---

## 架构

```
app/
  page.tsx                 → /train
  train/page.tsx           今日训练清单 + 今日概况
  train/[id]/page.tsx      训练执行（计时 / 休息 / 记录）
  stats/page.tsx           统计（周月季年）
  history/page.tsx         月历
  history/[date]/page.tsx  每日详情
  exercises/...            动作库 + 详情
  chat/page.tsx            对话（语音输入 + 播报）
  me/page.tsx              资料 / 记忆 / 数据
  api/plan                 今日清单增删改
  api/session, /session/set 训练会话与组记录
  api/chat, /meals, /memory, /today, /uploads, /gif
lib/
  core/workout.ts          清单、会话、统计、历史查询
  core/chat.ts             意图路由：排计划 / 训练建议 / 记饮食 / 记忆
  core/meals.ts            确认入库、今日快照
  core/enrich.ts           食物名+克数 → 营养
  memory.ts                记忆读写 + 规则抽取
  exercise.ts              动作查询
  exercise-label.ts        部位 / 器械 / 肌肉中文标签
  period.ts                周月季年区间、月历
components/                BottomNav / TrainingRunner / TodayPlan / ...
```

### 数据表

`profile` · `food_cache` · `meal_log` · `draft` · `memory` · `exercise`(1,324) · `plan_item` · `session` · `session_set`

### 四条设计原则

1. **AI 只做「非结构化 → 结构化」**，计算、筛选、计划全走确定性代码
2. **约束类记忆永远进上下文**，不做检索裁剪（忘掉「左肩有伤」会让人受伤）
3. **记忆写入必须用户确认**，冲突不静默覆盖，可随时删除
4. **事件数据查库，不当记忆**：吃了什么、练了什么都在关系表里，SQL 比向量检索准

---

## 测试与截图

```bash
npm run dev                      # 另开一个终端

node scripts/smoke.mjs           # 饮食/记忆/训练建议 端到端冒烟
node scripts/shot.mjs            # 对话主流程截图（00–06）
node scripts/shot-library.mjs    # 动作库截图（07–10）
node scripts/shot-training.mjs   # 训练全链路截图（11–21）
```

`scripts/shot-training.mjs` 会用真实浏览器走完：动作库加动作 → 改重量 → 开始训练 → 开始/结束本组 → 休息倒计时 → 结束训练 → 历史 → 统计 → 我的 → 对话排计划。

---

## 数据来源与许可

- **动作数据集**：[hasaneyldrm/exercises-dataset](https://github.com/hasaneyldrm/exercises-dataset)，1,324 个动作，代码与数据 MIT。
  - 使用了元数据字段与 180×180 缩略图（`public/exercises/`，约 11MB）
  - **未打包 GIF**：详情页首次访问由 `/api/gif/[id]` 按需拉取并缓存到 `data/gifs/`，失败自动回落静态图
  - 媒体版权归 [Gym visual](https://gymvisual.com/)，按数据集授权在 180×180 分辨率下使用
  - **已知限制**：数据集没有中文动作名，界面保留英文原名，常用 60+ 个补了中文叫法（`ZH_ALIAS`）
- **食物营养值**：常见食物近似值，仅供演示；正式产品建议接《中国食物成分表》或商业营养库

---

## 下一步

1. **渐进超负荷**：根据上次完成度自动建议下次重量（数据已够，缺算法与 UI）
2. **语音转写服务端化**：接 Whisper / 国内 ASR，解决浏览器支持面问题
3. **休息推荐**：按动作类型（复合/孤立）和组间目标心率给推荐值，而不是固定 90s
4. **微信客服适配层**：`core` 已与 channel 解耦，只差验签解密 + 消息收发
5. **睡眠录入 + 周报**
