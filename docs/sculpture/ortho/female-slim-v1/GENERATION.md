# 女性雕塑分区

源模型为 `fitcheck-sculpture-female-slim-v1.glb`。四张 1024×1536 底图由同一个 GLB 直接渲染，投影取景参数保存在 `ortho-meta.json`。

分区彩图由内置 imagegen 分别编辑四张底图后保存到 `colored/`。以下为实际提示词，每张图使用通用提示词加对应视角指令。

Edit this exact orthographic reference image into an unlit 2D muscle ID map for projecting to the original GLB. Preserve EXACT image framing 1024x1536, scale, canvas coordinates, pose and all silhouette edge positions. Lock the head, bun, shoulder, hands, knee, feet and clothing outlines to the attachment. Apply only flat paint. No lines, shadows, gradient, labels, zoom, crop, or new features. Head, hair, neck, hands below wrist, feet below ankle, and nonmuscle background, kneecap if distinctly exposed, and front shorts stay pure white #FFFFFF. Keep sports clothing as depicted. Map pectoral area on the opaque sports top in red, back in its corresponding colors even over the top. Color only the upper posterior glute area over shorts, stop at gluteal fold, rest of shorts white. Palette (exact solid RGB): Chest #FF0000; Deltoids #0000FF; Rectus abdominis #FFFF00; Obliques #00FFFF; Biceps #FF00FF; Triceps #FF8000; Forearms #8000FF; Lats #00FF00; Traps and upper back #008080; Lower back #804000; Glutes #FF0080; Quads #80FF00; Hamstrings #0080FF; Calves #800000. This is labeled anatomy on a clothed athlete statue, never remove clothing or move a boundary away from the underlying anatomy.

- front: Front, camera straight on: symmetrical pectorals red, shoulders blue, biceps magenta, lower arms purple, rectus abs yellow and lateral obliques cyan, quads lime directly below the shorts hem, calves dark red. No hot pink visible from the front. Do not place teal on neck or clavicle.
- back: Back, camera straight on: no red pectorals or abs. Teal upper back from base of neck below hair with neck white; green lats laterally descending toward ribs; brown lumbar spine between lats down to waist. Hot pink on the two upper rear shorts panels matching the glute curves. Blue delts, orange triceps, purple forearms, sky-blue hamstrings below the shorts hem, dark red calves.
- left: Left side profile, face points left. Keep side torso, foreground arm and their overlap exact. Main visible shoulder blue, forward upper-arm segment magenta, posterior upper-arm segment orange, forearm purple ending at wrist. Chest in front of arm red, abs yellow at anterior edge and cyan farther back, visible back teal/green/brown. Hot pink on posterior upper shorts only; keep hand white even where over shorts. Lime anterior thigh, sky blue posterior thigh, dark-red below knee.
- right: Right side profile, face points right. Keep side torso, foreground arm and their overlap exact. Main visible shoulder blue, forward upper-arm segment magenta, posterior upper-arm segment orange, forearm purple ending at wrist. Chest in front of arm red, abs yellow at anterior edge and cyan farther back, visible back teal/green/brown. Hot pink on posterior upper shorts only; keep hand white even where over shorts. Lime anterior thigh, sky blue posterior thigh, dark-red below knee.

反投沿用前一版的 14 类色表、法线加权、深度遮挡、模型中心面镜像、沿网格表面补洞和两轮多数平滑。预览是实际顶点标签渲染。

侧视图中手指和大腿重叠。`ortho-meta.json` 的 `front.backgroundGuards` 按这版模型的手腕位置保护手和指尖，防止腿部标签串色。胸部颜色覆盖上衣对应区域，臀部颜色覆盖短裤后上方。彩图在真实轮廓外有 1.78%–2.81% 的像素，反投依据原模型深度判定使用哪些像素。侧视图的肌群交界仍有少量生成图带来的偏差。

在项目根目录安装 `scripts/requirements-sculpture.txt` 后，可用已保存的彩图和相机参数复现：

```sh
python scripts/bake-sculpture-ortho.py \
  --model public/models/sculpture/female/fitcheck-sculpture-female-slim-v1.glb \
  --input docs/sculpture/ortho/female-slim-v1/colored \
  --meta docs/sculpture/ortho/female-slim-v1/ortho-meta.json \
  --out docs/sculpture/ortho/female-slim-v1/validation \
  --bin public/models/sculpture/female/sculpture-muscle-female-slim-ortho-v1.bin
```
