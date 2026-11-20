# 新石膏运动人体

## 输入和边界

- 唯一外观参考：`reference-front-back.png`，用户确认的生成图原文件。左边正面、右边背面是同一个人，不是两个人。
- 必须从参考图新建三维几何；不得导入或改造现有 porcelain、ecorche、MakeHuman / athletes、body.glb 的人体网格。
- 保留参考中的短裤、发型、运动体型、暖白哑光石膏和自然头颈/手腕/脚踝。肌肉整体饱满，无解剖纤维。
- 已生成新网格并保存为 `public/models/sculpture/fitcheck-sculpture-tripo-v1.glb`。生成服务：Tripo H3.1 image-to-3d；任务 ID：`01a1f409-d532-70b0-a565-848e2c472762`；输入为单张正面裁图 `reference-front.png`。预览确认是单一完整人体，未见双人误识别。

## 生成记录

- 已核实的候选端点：`fal-ai/hyper3d/rodin/v2.5`，支持 1–5 张参考图及 GLB 输出。
- 计划：先准备同一雕塑的独立正、背面输入，再生成一具完整人体。不能直接把两个人物并排的排版误当作两具雕塑。
- 计划参数：`tier=Gen-2.5-High`、`geometry_file_format=glb`、`material=PBR`、`quality_mesh_option=150K Triangle`、`texture_delight=true`、`preview_render=true`、`TAPose=false`。实际输入须按提交时有效 schema 验证。
- fal 官方端点页面公开价格：USD 0.40 / generation；可选 HighPack 额外 USD 0.80。计划不启用 HighPack。报价核实日期为 2026-11-19，实际收费以服务返回为准。
- 首次 Rodin 任务 `01a1f3e9-bf13-7123-8e7e-146d2e21d483` 误把并排正背参考生成为两个人，未接入页面。
- 单人正面 Rodin 重试 `01a1f3f0-b4c0-7833-888e-3775cd7f21eb` 与再次重试 `01a1f405-e0f0-74a2-b83a-69e8dc0aeb64` 均由供应商返回 500。
- 用户同意再次尝试后切换到 Tripo H3.1，成功输出 GLB 与预览图。原始预览：`https://v3b.fal.media/files/b/0ab31949/N3sGC0GfuL1qBybCWC1ql_preview.png`。

## 新网格生成规格

Create ONE complete, rotatable adult male athletic plaster sculpture from the supplied reference. The left and right figures are FRONT and BACK views of the SAME subject. Reconstruct a single full 3D body, not a pair of statues, image plane, relief, or two-sided billboard. Use only these reference images; do not substitute a pre-existing human mesh. Preserve the reference face, short swept hair, fitted opaque mid-thigh athletic shorts, relaxed symmetrical standing pose, proportional hands and feet, and approximately eight-head athletic proportions. Smooth full-volume pectorals, abs, shoulders, arms, thighs and calves; no shredded muscle fibers or exposed tendon lines. Head/neck, wrists/hands and ankles/feet must have continuous organic transitions. No cuffs, cut surfaces or gaps at those joints. Both hands have five fingers; both feet have five toes. Warm ivory matte plaster, consistent across all surfaces, zero metalness, high roughness. Do not bake the reference's studio shadows into base color; sculpt actual geometry that responds correctly to lighting and rotation. No pedestal, background geometry, text, logo or UI. Export an editable GLB with usable surface normals and non-overlapping body UVs. Preserve details in geometry or normal maps; provide the original high-quality mesh and a lighter web version if supported.

## 检查顺序

1. 模型已接入新 viewer；后续需检查正面、背面、侧面与三分之四视角，确认轮廓、颈长、手指、脚趾、短裤、关节及表面连续性。
3. 用中性纯色材质查看网格，确认肌肉体量不是仅靠投影照片形成的假象。
4. 保留原始生成文件，另存网页资产；记录实际生成服务、模型版本、任务 ID 与处理步骤。
5. 新模型通过外形检查后，再标注训练选区；未通过时不要替换正式页面。

## 肌群联动

复用 `lib/muscles.ts` 的 22 个稳定 ID 和 `/api/exercises?muscle=...`。分区是同一网格的表面标签，不再用分离的实体肌肉拼装身体。

`chest_upper`, `chest_mid`, `chest_lower`, `serratus`, `abs`, `obliques`, `delt_front`, `delt_side`, `delt_rear`, `biceps`, `triceps`, `forearms`, `traps`, `lats`, `upperback`, `lowerback`, `glutes`, `quads`, `hamstrings`, `calves`, `adductors`, `neck`.

- 点击最近的可见表面，根据三角面标签或 UV 分区图得到肌群 ID；头、手、脚等非训练区域不穿透选择背面的肌肉。
- 高亮和训练热力图使用同一套分区，不改变几何位置或表面法线。
- 短裤覆盖区域标记为训练部位示意；不声称展示了其下方真实肌肉分界。小范围或被遮挡的肌群提供文字选择入口。
- 验证：胸、二头、股四头、背阔、臀部的点击及动作列表；正背切换；拖动不误触；加入计划；已有肌肉深链；移动端显示。
