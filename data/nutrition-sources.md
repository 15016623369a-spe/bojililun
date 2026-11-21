# 本地营养数据来源

- 台湾卫生福利部食品药物管理署《食品营养成分资料集》，[政府资料开放授权条款第 1 版](https://data.gov.tw/license)。[官方数据页](https://data.gov.tw/dataset/8543)
- 台湾食药署的下载主机在导入环境中无法解析。内置快照使用同一数据集的结构化镜像，固定版本 `da3bd63ee385638c7c490bc7999507ad70572b70`。[镜像与数据来源说明](https://github.com/liao961120/Taiwan-FDA-nutrition/tree/da3bd63ee385638c7c490bc7999507ad70572b70)
- USDA Agricultural Research Service, FoodData Central, SR Legacy, April 2018，CC0。内置含完整四项营养值的条目均保留 FDC ID，高频鸡肉部位另配中文别名。[官方数据下载](https://fdc.nal.usda.gov/download-datasets/)

运行 `python3 scripts/import-nutrition.py item.csv nutrition.csv USDA-SR-Legacy.zip` 重新生成数据。脚本使用 OpenCC `tw2s.json` 转换中文。卡片和导出的引用标明所用数据源。台湾数据里的废弃率来自对应样品，熟重沿用该比例时为近似值；无可用比例的带骨食材暂按 30% 估计，并在卡片标注。
