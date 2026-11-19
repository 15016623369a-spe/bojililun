/**
 * ecorche 模型（Charleeh/ecorche，CC BY-SA 4.0）→ 我们的 22 个肌群。
 *
 * 名字是解剖学全名，例如：
 *   Clavicular part of left pectoralis major   → 上胸
 *   Spinal part of left deltoid                → 三角肌后束
 *   Long head of right triceps brachii         → 肱三头肌
 * 左右在名字里（left/right），node.extras.side 也有。
 */
import type { MuscleId } from './muscles';

// 顺序敏感：先匹配特殊部位，再落到大肌群
const RULES: Array<[RegExp, MuscleId]> = [
  [/pectoralis major/i, 'chest_mid'],
  [/clavicular part of (left|right) pectoralis/i, 'chest_upper'],
  [/abdominal part of (left|right) pectoralis/i, 'chest_lower'],
  [/sternocostal part of (left|right) pectoralis/i, 'chest_mid'],
  [/serratus anterior/i, 'serratus'],
  [/clavicular part of (left|right) deltoid/i, 'delt_front'],
  [/acromial part of (left|right) deltoid/i, 'delt_side'],
  [/spinal part of (left|right) deltoid/i, 'delt_rear'],
  [/trapezius/i, 'traps'],
  [/latissimus dorsi|teres major/i, 'lats'],
  [/rhomboid|levator scapulae|infraspinatus|supraspinatus|teres minor/i, 'upperback'],
  [/iliocostalis|longissimus|spinalis|quadratus lumborum|multifidus|thoracolumbar fascia/i, 'lowerback'],
  [/biceps brachii|brachialis/i, 'biceps'],
  [/triceps brachii|anconeus/i, 'triceps'],
  [/brachioradialis|flexor carpi|extensor carpi|palmaris longus|pronator|supinator|extensor digitorum(?! longus)|flexor digitorum superficialis|flexor pollicis longus|abductor pollicis longus|extensor pollicis longus|extensor pollicis brevis|extensor digiti minimi|flexor retinaculum/i, 'forearms'],
  [/rectus abdominis|linea alba|pyramidalis/i, 'abs'],
  [/external oblique|internal oblique|transversus abdominis/i, 'obliques'],
  [/gluteus|piriformis/i, 'glutes'],
  [/rectus femoris|vastus|sartorius|tensor fasciae latae/i, 'quads'],
  [/biceps femoris|semitendinosus|semimembranosus|popliteus/i, 'hamstrings'],
  [/gastrocnemius|soleus|calcaneal tendon/i, 'calves'],
  [/adductor (longus|magnus|brevis|minimus)|gracilis|pectineus|obturator externus/i, 'adductors'],
  [/sternocleidomastoid|scalenus|splenius|omohyoid|sternohyoid|sternothyroid|thyrohyoid|longus (capitis|colli)/i, 'neck'],
];

// 头面部：健身 App 里不需要，默认隐藏
const FACE =
  /frontalis|orbicularis|zygomaticus|nasalis|mentalis|risorius|procerus|masseter|temporalis|depressor anguli|depressor labii|levator labii|levator anguli|occipitalis|auricularis|corrugator|platysma|buccinator|digastric|mylohyoid|geniohyoid|stylohyoid|tongue|lingual/i;

// 手、脚的小肌群：缩略尺寸下是碎块，直接并进前臂 / 小腿
const HAND = /of (left|right) hand|interossei of (left|right) hand|lumbricals of (left|right) hand/i;
const FOOT = /of (left|right) foot|hallucis|digiti minimi of (left|right) foot|plantar/i;

export function ecorcheFaceOrJunk(name: string): boolean {
  return FACE.test(name);
}

export function groupForEcorcheName(name: string): MuscleId | null {
  if (ecorcheFaceOrJunk(name)) return null;
  for (const [re, id] of RULES) {
    if (!re.test(name)) continue;
    // 手/脚的 adductor、flexor digitorum 之类不要串到腿/前臂上
    if (id === 'adductors' && HAND.test(name)) return 'forearms';
    if (id === 'adductors' && FOOT.test(name)) return 'calves';
    return id;
  }
  if (HAND.test(name)) return 'forearms';
  if (FOOT.test(name)) return 'calves';
  return null;
}

export const SHOW_LAYER = 'superficial muscles';
