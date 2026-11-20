# 正交彩图反投结果

已生成离线校验版本；没有修改页面、加载逻辑或部署配置。

## 交付物

- `../../../../public/models/sculpture/sculpture-muscle-ortho-v1.bin`：154,471 字节，Uint8，每个原始顶点一个标签，无文件头。
- 同名 `.json`：模型与输入 SHA-256、顶点顺序、标签 ID、细分肌群联动映射、处理参数、完整验证统计。
- `sculpture-muscle-ortho-review.png`：正面、背面、左右侧面的 3D 网格渲染拼图。
- `3d-{front,back,left,right}.png`：独立视图。
- `alignment-*.png`：生成彩图与真实模型投影的对齐诊断。深灰线是模型轮廓，红色是落在模型轮廓外的彩色像素，不是最终标签。
- `bake-report.json`：与标签旁的 JSON 同步。

原图在上一级目录，image_gen 生成的 1024×1536 彩图与实际提示词保存在 `../colored/`。臀部按用户后续要求涂在短裤上，其他短裤区域保持非肌肉标签。

## 格式与 ID 兼容

顶点顺序为 GLTFLoader 场景遍历顺序，每个 mesh primitive 内保持 POSITION accessor 原始顺序，未重排或改写模型。当前模型只有一个 primitive、154,471 个顶点、292,756 个三角形。镜像计算临时合并 UV 接缝，不改变交付二进制的顶点数量和顺序。

二进制值沿用 `lib/sculpture.ts` 的 `SCULPTURE_ORDER` 索引，不是另起一套 0–13 编号。254 表示明确排除的非肌肉区域；255 表示未分配，本次为零。

| 大类 | 写入的现有 ID | 字节值 | 联动细分 ID |
|---|---|---:|---|
| 胸 | chest_mid | 3 | chest_upper / chest_mid / chest_lower |
| 肩 | delt_side | 6 | delt_front / delt_side / delt_rear |
| 腹直肌 | abs | 11 | abs |
| 腹斜肌 | obliques | 12 | obliques |
| 肱二头肌 | biceps | 8 | biceps |
| 肱三头肌 | triceps | 9 | triceps |
| 前臂 | forearms | 10 | forearms |
| 背阔肌 | lats | 15 | lats |
| 斜方肌与上背 | upperback | 14 | traps / upperback |
| 下背 | lowerback | 16 | lowerback |
| 臀部 | glutes | 17 | glutes |
| 股四头肌 | quads | 18 | quads |
| 腘绳肌 | hamstrings | 19 | hamstrings |
| 小腿 | calves | 21 | calves |

未来页面接入时，先用 JSON 的 `fineToCanonical` 将选中/已记录肌群转成大类，再查对应字节值；点击返回 canonicalId。当前系统不分左右 ID。原有 neck、serratus、adductors 没有本次色表中的独立标签，不臆造细分解剖边界。

## 算法与限制

1. 应用 GLB node 世界变换、法线逆转置矩阵，再按 `ortho-meta.json` 的 modelCenter、yaw、orthoHalfHeight、aspect 投影。像素取样使用归一化坐标，不假设输入是 1400×2100。
2. RGB > 240 的近白像素为背景。生成器还在白色区域留下了无彩色细轮廓线，故额外移除 RGB 最大最小通道差 < 64 的灰线；色表最小通道差为 128。其余像素按 RGB 欧氏距离匹配最近色。
3. 三角形 z-buffer 检查可见性，再以 max(0, dot(N,V)) 投票。边缘 6 像素范围内的白色不投票；没有直接色票时才用邻近有效像素补充。深白内部属于明确非肌肉掩膜，在其加权证据超过彩色证据 1.35 倍时保护手、脚和短裤，防止侧面错位染到这些区域。
4. 模型原生朝向 +X，所以左右镜像平面是**原生 Z 中心面**，不是世界 X=0。绑定所有最近镜像对应和重合接缝顶点，汇总四视图证据。补洞与两轮多数表决都在这个约束下执行。154,471 个镜像最近顶点检查全部同标签。模型几何本身略有不对称，顶点对应采用最近点；这不表示修改了模型几何使其完全对称。
5. 未命中的 17,999 个顶点通过沿网格边的多源最短路径补齐，包含传播明确背景标签；不会通过空间距离直接跨越腋下/腿间空气缝隙。最后无 255 标签，14 类肌群均非空。上部头颈有显式保护阈值，详见 JSON。
6. 生成图不能保证逐像素吻合：各图约 1.78%–2.70% 彩色像素落在真实轮廓外，这些越界像素中 95% 距轮廓不超过约 3–5.1 像素。对齐诊断保留了这一事实；反投只作用于实际网格。肌群边界属于 AI 推断，仍需看 3D 校验图确认。

渲染从真实顶点标签和法线生成；轻微明暗只用于显示 3D 体积。米白色代表非肌肉，不是未分配空洞。

## 复现

在项目根目录，用 Python 3.9–3.12 创建隔离环境，并安装 `scripts/requirements-sculpture.txt`：

```sh
python3 -m venv /tmp/sculpture-bake-venv
/tmp/sculpture-bake-venv/bin/pip install -r scripts/requirements-sculpture.txt
/tmp/sculpture-bake-venv/bin/python scripts/bake-sculpture-ortho.py
/tmp/sculpture-bake-venv/bin/python scripts/test-sculpture-ortho.py
```

已通过 5 项针对投影缩放、法线方向、白色/灰线与最近色匹配、遮挡、表面距离补洞、镜像/接缝一致性的测试，以及最终文件长度、SHA-256、合法 ID、14 类覆盖、镜像一致性和未分配值检查。
