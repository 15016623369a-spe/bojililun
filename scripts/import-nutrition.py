"""Build the local catalog from TFDA normalized CSVs and USDA SR Legacy ZIP."""
import csv
import io
import json
import subprocess
import sys
import zipfile
from pathlib import Path

tfda_items, tfda_nutrition, usda_archive = sys.argv[1:]
tw_macros = {row['ID']: row for row in csv.DictReader(open(tfda_nutrition, encoding='utf-8-sig'))}
items = list(csv.DictReader(open(tfda_items, encoding='utf-8-sig')))
source_fields = ['ITEM', 'COMMON_NAMES']
original = [' '.join(row[k].splitlines()) for row in items for k in source_fields]
simplified = subprocess.check_output(['opencc', '-c', 'tw2s.json'], input='\n'.join(original).encode()).decode().split('\n')
assert len(simplified) == len(original)

def number(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None

def nutrients(values):
    return dict(zip(('kcal', 'protein_g', 'carbs_g', 'fat_g'), map(number, values)))

catalog = {}
for index, row in enumerate(items):
    key = row['ID']
    n = tw_macros.get(key)
    if not n:
        continue
    values = nutrients([n[k] for k in ('熱量', '粗蛋白', '總碳水化合物', '粗脂肪')])
    if any(v is None for v in values.values()):
        continue
    name, common = simplified[index * 2:index * 2 + 2]
    desc = row['CONTENT_DESC']
    state = 'raw' if desc.startswith('生') else 'cooked' if desc.startswith(('熟', '煮')) else 'unknown'
    aliases = [original[index * 2], *common.split(','), *row['COMMON_NAMES'].split(',')]
    catalog['tfda:'+key] = dict(name=name, state=state, aliases=sorted({a.strip() for a in aliases if a.strip() not in ('', 'NA')}), refuse=number(row['DISPOSAL_RATE']), **values)

# Canonical families give common mainland names an unambiguous raw/cooked mapping.
families = {
    'chicken': [['鸡肉','雞肉','整鸡','整雞','炖鸡','燉雞','煮鸡肉'], 'usda:171052','usda:171451', None],
    'breast': [['鸡胸肉','雞胸肉','鸡胸','雞胸','鸡柳','雞柳'], 'tfda:I04024','usda:171478', None],
    'thigh': [['鸡腿肉','雞腿肉','鸡腿','雞腿'], 'tfda:I0404501','usda:172389','tfda:I04041'],
    'beef': [['牛肉','瘦牛肉','熟牛肉','牛肉末','牛肉碎'], 'usda:174030','usda:171793',None],
    'rice': [['米饭','米飯','白饭','白飯','白米饭','熟米饭'], None,'tfda:A0550601',None],
    'milk': [['牛奶','纯牛奶','全脂牛奶','鲜奶','鮮奶','鲜牛奶'], 'tfda:L01021','tfda:L01021',None],
    'tofu': [['豆腐','老豆腐','板豆腐','北豆腐'], None,'tfda:R4700901',None],
    'broth': [['鸡汤','雞湯','鸡肉汤','雞肉湯','鸡高汤','雞高湯','撇油鸡汤'],None,'tfda:I0420601',None],
}
with zipfile.ZipFile(usda_archive) as archive:
    def rows(t):
        path = next(f for f in archive.namelist() if f.endswith('/'+t+'.csv'))
        return csv.DictReader(io.TextIOWrapper(archive.open(path), encoding='utf-8-sig'))
    fields = {'1008':'kcal', '1003':'protein_g','1005':'carbs_g','1004':'fat_g'}
    by_id = {}
    for row in rows('food_nutrient'):
        if row['nutrient_id'] in fields and row['amount']:
            by_id.setdefault(row['fdc_id'], {})[fields[row['nutrient_id']]] = float(row['amount'])
    for row in rows('food'):
        code, name = row['fdc_id'], row['description']
        values = by_id.get(code, {})
        if len(values) == 4:
            terms = name.lower().split(', ')
            state = 'raw' if 'raw' in terms else 'cooked' if any(t in terms for t in ('cooked', 'stewed', 'boiled', 'roasted', 'baked')) else 'unknown'
            catalog['usda:'+code] = dict(name=name, state=state, aliases=[], refuse=None, **values)

for _, raw, cooked, refuse in families.values():
    for key in (raw,cooked,refuse):
        assert key is None or key in catalog, key
Path('data/nutrition-catalog.json').write_text(json.dumps(dict(foods=catalog,families=families), ensure_ascii=False, separators=(',',':'))+'\n')
