# FitCheck 项目与设计交接

本次交接日期为 2026-11-21。功能说明核对自 `main` 的 `6f51928`。今天的三屏图和视频是设计稿，展示的是示例数据。接手时先看 [记录与回顾概念图](docs/design/2026-11-21/record-and-review.png)、[训练统计概念图](docs/design/2026-11-21/training-stats.png) 和 [统计切换动效](docs/design/2026-11-21/training-stats-motion.mp4)。

**复刻新版视觉时，从 [视觉复刻规格](docs/design/2026-11-21/visual-handoff.md) 和 [用户确认的点阵计划首屏](docs/design/2026-11-21/plan-point-matrix-reference.png) 开始。** 使用新版参考图决定版式、配色和材质，现有页面用于核对功能。计划首屏的识别特征是银灰整屏、大字标题、随人体明暗变化的细圆点、唯一的柠檬黄肌群锚点和悬浮炭黑导航。点选进入详情后，参考对应的灰白石膏姿势稿和雾银面板。点阵原稿、现有 3D 模型的复用方式及手机验收场景都在复刻规格中。

## 产品与代码入口

FitCheck 是以手机为主的中文健身记录应用。用户在人体模型上选肌群、安排动作，逐组记录实际重量和次数，也可以用文字或语音记训练和饮食。回顾页回答「这段时间练了什么」，统计页进一步回答「练了多少、集中在哪些肌群、动作表现怎样变化」。

主导航以手账的 [TabBar](components/fc/TabBar.tsx) 为准：计划 `/atlas`（与 `/body` 同一页）、记录 `/log`（长按就地录音、上滑取消）、回顾 `/review`。[JournalShell](components/JournalShell.tsx) 默认渲染这个 TabBar。`/` 会把新用户送去 `/setup`，其余转到 `/log`；`/history` 按日／周／月转到 `/review`。改用户截图里的主流程时，从下表中的路由进入验证。

| 用户入口 | 当前行为与接手位置 |
| --- | --- |
| 新用户建档、我的 | `/setup` 一屏一问建立训练档案（目标必选，其余可跳过，最后可挑常练动作），有旧资料或记录的用户可直接进入。`/me` 管理训练目标、体重、伤病与限制、营养设置；`/me/exercises` 管理动作偏好。资料中的性别联动默认男女模型。见 [档案与旧数据判定](lib/core/training-profile.ts)、[建档流程](components/SetupFlow.tsx)、[个人页面](components/TrainingProfileDashboard.tsx)。 |
| 计划 | `/body` 是主导航的计划页。首屏是点阵人体，拖动旋转，点肌群后推近到该部位的石膏姿势和雾银抽屉；「动作库」「我的动作库」里可连续点动作、再点取消，点「完成」才统一写入今日计划；「开始训练」直接开练。讲解有独立入口。常练动作排在前，不喜欢的动作靠后。见 [PlanBody](components/fc/PlanBody.tsx)、[PlanDetail](components/fc/PlanDetail.tsx)、[ExerciseSheet](components/fc/ExerciseSheet.tsx)。 |
| 训练 | `/train` 配置今日动作、组次、重量和休息；`/train/[id]` 记录实练组。计划完成后再次开始可确认加练（`/train/extra` 在点阵人体上挑动作），追加动作有火花标记。见 [今日计划](components/TodayPlan.tsx)、[训练执行](components/TrainingRunner.tsx)、[训练数据](lib/core/workout.ts)。 |
| 记录 | `/log` 是「记录」页，数据、计算和录入走手账（[ledger](lib/ledger.ts)、[导出](lib/export.ts)），版式是新版：「今天」+ 大号日期，一天的时间刻度，训练／饮食／体重横向卡片，选中卡在下方展开明细（训练按动作列组次和容量），待确认的卡片带珊瑚色标记，快选、备注和份量重算仍是 [LedgerCards](components/fc/LedgerCards.tsx) 的逻辑。长按底部「记录」就地录音。饮食拍照识别在 `/chat`（珊瑚色结果卡可整体调份量或逐项 ±10 g）。见 [记录页](app/log/page.tsx)、[LedgerDeck](components/LedgerDeck.tsx)、[LogScreen](components/fc/LogScreen.tsx)、[RecordTab](components/fc/RecordTab.tsx)。旧的 `/` 记录页（[RecordToday](components/RecordToday.tsx)、[VoiceOverlay](components/VoiceOverlay.tsx)）已不再接入路由，组件暂留。 |
| 回顾 | `/review` 是「回顾」页，数据和计分走手账（`exportJournal`、`calcMuscleHeatmap`、`calcWeightTrend`，区间截止到今天），版式是新版：日／周／月、大号容量、每日容量柱（点柱看当天）、训练天数与训练组读数、蓝色石膏热图和肌群档位、晨重点阵、按日横条记录、导出。底部链接进入训练统计、训练月历、训练计划和动作库，右上角头像进入「我的」。见 [回顾页](app/review/page.tsx)、[LedgerReview](components/LedgerReview.tsx)。日详情 `/history/[date]` 和月历 `/history/calendar` 保留新版样式；旧的周月概览（[ReviewJournal](components/ReviewJournal.tsx)）已不接入路由，组件暂留。 |
| 训练统计 | `/stats` 共用周、月、季、年筛选。底部胶囊是页内导航「总览／肌群／动作」：总览可在容量和运动时间之间切换，肌群页是二维正反面加珊瑚面板与可展开对比，动作页按 PR／8–12 RM／12–15 RM 切换数值和曲线。见 [统计入口](app/stats/page.tsx)、[StatsBoard](components/StatsBoard.tsx)、[人体标注坐标](components/StatsBodyMap.tsx)。 |

## 11 月 21 日的视觉方向

以用户认可的「记录与回顾」三屏和原参考视频为基调。银灰、浅灰与黑白铺底，大号数字、细刻度和规整的点阵形成屏幕质感。点阵可以是模型背景、计时读数、波形或数据柱。重要的中文标签保持清楚，数字单位紧邻数值。动作缩略图和人体模型沿用项目素材。

| 设计元素 | 在这版概念中的用法 |
| --- | --- |
| 灰阶与字体 | 屏幕底约 `#E2E3DF`，墨黑约 `#151613`。数字可用黑和中灰分段排印。中文靠字重与留白建立层次；数字、单位、时间轴按同一网格对齐。概念使用 Helvetica Neue 与苹方的系统字体组合。 |
| 多色搭配 | 用户希望配色丰富且协调。最新统计稿用柠檬黄 `#F2ED21` 表示容量、雾蓝 `#91BCE8` 表示时长、珊瑚红 `#F06351` 承接选中肌群、淡紫 `#BDADF0` 承载动作曲线。这是本稿的取色示例，可随页面调整。大面积保留中性色；一个状态突出一个读数，同时用单位、标题和选中样式解释颜色。 |
| 计划与训练 | 首屏用点阵描出整个人体，拖动旋转，点击肌群。详情概念用灰白石膏摆姿和雾银面板，提供「动作库」「我的动作库」「开始训练」。参考 [首屏](docs/design/2026-11-21/plan-point-matrix-reference.png)、[胸部面板右图](docs/design/2026-11-21/chest-panel-comparison.png) 和 [各部位姿势](docs/design/2026-11-21/plan-poses-all.png)。 |
| 记录与回顾 | 记录页以日期大字、时间刻度和横向训练／饮食卡定位一天。语音态出现点阵计时、随音量变化的波形及珊瑚色转写区。回顾页用一根高亮柱对应选中日期，最近记录维持横条列表。 |
| 统计与动效 | 总览切容量／时间时，保留日期位置，联动柱高、读数、单位和强调色。肌群页用项目模型的二维正反面，点选后展开该区读数与对比。动作页保留图片和折线，切 RM 档位同时切指标、数值与曲线。跨视图采用短距离横移，详情沿模型下缘展开。 |

**落地进度。** 新版视觉分四个阶段实施，每个阶段一个 PR：① 全局色系、导航和计划页（已实施）；② 训练流程（已实施）；③ 记录与回顾（已实施）；④ 统计（已实施）；之后补了「我的」、动作偏好、建档、加练选动作和饮食拍照确认，主流程页面均已换成新版。新样式集中在 [visual.css](app/visual.css) 和按页面拆分的 `app/v-*.css`，通用部件在 [components/ui](components/ui/)，色彩令牌在 [globals.css](app/globals.css) 的 `:root`。部位姿势图男女共用。各阶段的实现位置和取舍见 [视觉复刻规格](docs/design/2026-11-21/visual-handoff.md) 的「实施进度与代码位置」。

**已对齐的产品选择。** 记录和回顾以 main 的手账页（`/log`、`/review`）为准，主导航统一为 TabBar（用户 11 月 22 日确认）。建档改为一屏一问：训练目标必选，性别、体重、伤病限制可跳过；最后一步可按部位挑常练动作写入「我的动作库」，也可跳过（用户 11 月 22 日确认）。动作偏好仍可在「我的」中维护。计划页详情采用雾银毛玻璃面板。

## 模型热力图与统计口径

- **现有回顾热图**用于 `/history` 的 3D 模型。周／月频次等于「本期练到该肌群的不同日期数 ÷ 本期训练日数」，同一肌群同一天计一次；当前色阶分界为三分之一和三分之二。日视图标出当天实练部位。复用 [ReviewBody](components/ReviewBody.tsx)、[肌群与男女模型映射](lib/sculpture-groups.ts) 和 [模型材质](components/fc/SculptureBody.tsx)，沿真实肌肉分区着色，保留雕塑光影。
- **回顾新版热图，用户已于 11 月 21 日确认。** 11 月 22 日改为以手账数据为准后，`/review` 暂用 main 的 `calcMuscleHeatmap` 计分（主要肌群每组 10 分、次要 4 分，按日／周／月阈值分三档），同一蓝色由浅到深，肌群卡显示少量／适中／较多；下面的频次／容量切换仍在旧组件 ReviewJournal 中，接回前需在手账计算里补齐口径。原方案：周／月默认看频次，也可切换到容量。频次图用同一蓝色从浅到深，容量图用同一珊瑚色从浅到深。建议容量深浅按本期有负重记录的肌群最高值归一，图例写清「本期最高」，点肌群显示实际 kg。纯自重或缺重量的训练仍可计入频次；无可计算负重时标「无负重数据」。同一批虚构记录可见 [回顾热图提案](docs/design/2026-11-21/review-heat-proposal.png)。已确认：默认指标为频次，容量色阶按本期最高的肌群归一。
- **统计肌群图**使用项目男女雕塑的二维正反面图，资源在 [sculpture](public/models/sculpture/)。容量按实练组的「重量 × 次数」累计，复用 `primaryMuscleActivity`，每个动作只归入一个主要肌群。肌群对比支持组数、容量、训练次数与时长；周和月按天，季按三个月，年按十二个月。见 [肌群汇总](lib/muscle-distribution.ts)。
- **动作表现**根据本周期的实练组自动更新。PR 对 1–15 次的负重组取最高估算 1RM，单次用实举重量，其余用 `重量 × (1 + 次数 / 30)`，问号在原处展开公式。8–12 RM 与 12–15 RM 分别显示对应次数范围内实际完成的最重一组；12 次可计入两档。曲线随档位变化。样例中的 80 kg、60 kg 等数字仅用于展示。

## 本地开发与验证

Next.js 15 App Router、React 19、TypeScript、Three.js；服务端用 Node 的 `node:sqlite`。默认数据库是 `data/fitness.db`，可通过 `FITCHECK_DB_PATH` 指定测试库。图片识别默认走 mock，接真实服务的配置名见 [.env.example](.env.example)。业务计算与持久化在 [lib/core](lib/core/) 和 [数据库初始化](lib/db.ts)，新视觉的切换状态不应改变实际统计结果。

- 安装依赖后用 `npm run dev` 启动 HTTPS 开发服务，默认端口 3001；仅用 HTTP 调试可运行 `npm run dev:http`。脚本清单见 [package.json](package.json)，详细启动步骤见 [README](README.md)。
- `npm run typecheck` 检查类型，`npm run build` 验证生产构建。跑会写数据的 `npm run smoke` 或训练截图时，可先用 `FITCHECK_DB_PATH=/tmp/fitcheck-demo.db npm run dev:http` 启动独立的演示库，再从另一个终端执行相应命令。
- 训练与模型截图脚本分别为 `npm run shot:training`、`npm run shot:body`。复核视觉时检查正常入口、同一日期与数据、单位和选中态。设计概念图用于讨论；PR 对照图取自目标分支与改动分支实际运行的相同场景。

## 提交 Pull Request

每次创建 PR，或向已有 PR 追加改动，都要先准备改动前后的对照截图和更改说明。

1. **截取改动前效果。** 使用目标分支的对应版本，记录受影响的页面、操作或输出。如果改动已经完成，用独立工作树或临时副本复现改动前的效果，保留当前工作区的改动。
2. **截取改动后效果。** 在相同的页面、操作步骤、数据和视口下截图。涉及多个重要页面或状态时，分别提供对照。使用测试数据，避免在截图中暴露个人资料、凭据和真实训练或饮食记录。
3. **写好 PR 说明。** 简要交代改动原因、用户能看到或体验到的变化，以及实际完成的验证。按页面或场景依次标明「改动前」「改动后」，将两张图内嵌到正文，并确认 GitHub 上的审阅者能打开。
4. **确认材料齐全后再提交。** 创建 PR 前确认说明与图片对应。向已有 PR 追加改动时，同步更新其说明和对照截图，保留仍然有用的历史说明。

没有可见界面改动时，用相同输入下的改动前后运行结果截图作为对照，并说明验证场景。如果无法取得可靠的对照截图，先说明缺少哪一项并询问用户如何处理。
