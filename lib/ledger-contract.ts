// JSON Schema used in the provider prompt. The write boundary checks the same
// discriminators, value ranges and required detail arrays before commit.
const text = { type: 'string' };
const nullableText = { type: ['string', 'null'] };
const number = { type: ['number', 'null'], minimum: 0 };
const integer = { type: ['integer', 'null'], minimum: 0 };
const confidence = { enum: ['exact', 'estimated'] };
const object = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
const list = (items: unknown, minItems = 0) => ({ type: 'array', items, minItems });
const context = {
  summary_title: text,
  raw_text: nullableText,
  note: nullableText,
  feeling_tags: list(text),
  confidence,
};
const itemFields = {
  food_name: text,
  portion_text: nullableText,
  estimated_grams: number,
  kcal: integer,
  protein_g: number,
  carbs_g: number,
  fat_g: number,
  confidence,
};
const item = object(
  {
    ...itemFields,
    food_state: { enum: ['raw', 'cooked', 'unknown'] },
    weight_basis: { enum: ['edible', 'bone_in', 'unknown'] },
  },
  Object.keys(itemFields),
);
const set = object({ weight_kg: number, reps: integer, duration_sec: integer });
const movement = object({ exercise_name: text, sets: list(set) });
const edits = object(
  {
    item_index: { type: 'integer', minimum: 0 },
    measured_grams: { type: 'number', minimum: 0, maximum: 1000000 },
    food_state: { enum: ['raw', 'cooked', 'unknown'] },
    weight_basis: { enum: ['edible', 'bone_in', 'unknown'] },
  },
  ['item_index'],
);
const mealPick = object({
  kind: { const: 'meal' },
  question: text,
  options: list(object({ label: text, edits: list(edits) }), 2),
});
const workoutPick = object({
  kind: { const: 'workout' },
  question: text,
  exercise_index: { type: 'integer', minimum: 0 },
  options: list(object({ label: text, sets: { type: 'integer', minimum: 1, maximum: 20 } }), 2),
});
export const parseSchema = {
  oneOf: [
    object({ route: { const: 'qa' }, question: text }),
    object({
      route: { const: 'record' },
      records: list(
        {
          oneOf: [
            object(
              { ...context, entry_type: { const: 'meal' }, items: list(item, 1), quick_pick: mealPick },
              [...Object.keys(context), 'entry_type', 'items'],
            ),
            object(
              {
                ...context,
                entry_type: { const: 'workout' },
                exercises: list(movement, 1),
                quick_pick: workoutPick,
              },
              [...Object.keys(context), 'entry_type', 'exercises'],
            ),
            object({ ...context, entry_type: { const: 'plan_draft' } }),
            object({
              ...context,
              entry_type: { const: 'body_metrics' },
              weight_kg: { type: 'number', exclusiveMinimum: 0 },
              body_fat_pct: { ...number, maximum: 100 },
            }),
          ],
        },
        1,
      ),
    }),
  ],
};

type Schema = {
  oneOf?: Schema[];
  type?: string | string[];
  const?: string;
  enum?: string[];
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  items?: Schema;
  minItems?: number;
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: boolean;
};
function conforms(value: unknown, s: Schema): boolean {
  if (s.oneOf) return s.oneOf.filter((option) => conforms(value, option)).length === 1;
  if (s.const !== undefined) return value === s.const;
  if (s.enum) return typeof value === 'string' && s.enum.includes(value);
  const types = Array.isArray(s.type) ? s.type : [s.type];
  if (value === null) return types.includes('null');
  if (Array.isArray(value))
    return (
      types.includes('array') &&
      value.length >= (s.minItems ?? 0) &&
      value.length <= 1000 &&
      value.every((v) => s.items && conforms(v, s.items))
    );
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>,
      fields = s.properties ?? {};
    return (
      types.includes('object') &&
      (s.required ?? []).every((k) => Object.hasOwn(obj, k)) &&
      Object.keys(obj).every((k) => Object.hasOwn(fields, k) && conforms(obj[k], fields[k]))
    );
  }
  if (typeof value === 'number')
    return (
      Number.isFinite(value) &&
      (types.includes('number') || (types.includes('integer') && Number.isInteger(value))) &&
      value >= (s.minimum ?? -Infinity) &&
      value <= (s.maximum ?? Infinity) &&
      value > (s.exclusiveMinimum ?? -Infinity)
    );
  return types.includes(typeof value);
}
export function validateParse(value: unknown) {
  if (!conforms(value, parseSchema as Schema)) throw Error('解析结果不符合手账格式，请重试');
}
