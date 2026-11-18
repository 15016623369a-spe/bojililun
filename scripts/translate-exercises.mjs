/**
 * 把 exercises-dataset 的英文动作名翻译成中文。
 *
 * 做法：短语优先 + 逐词兜底。
 *  1. 去掉 (male)/(female)/v. 2/pov 这类噪声，括号内容单独翻译成「（…）」
 *  2. 长的固定搭配（bench press / lat pulldown …）先整体替换
 *  3. 剩下的词逐个查词典，函数词（on / with / to …）直接丢弃
 *  4. 任何未命中的词都会让 status=partial，输出里带 unknowns 方便补词
 *
 * 产物：data/exercise-zh.json  → { id, en, zh, status, unknowns }
 * 用法：node scripts/translate-exercises.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

/* ----------------------------- 短语表（优先匹配） ----------------------------- */
const PHRASES = {
  // 卧推 / 推类
  'bench press': '卧推',
  'chest press': '推胸',
  'shoulder press': '肩推',
  'military press': '军事推举',
  'overhead press': '过头推举',
  'arnold press': '阿诺德推举',
  'floor press': '地板卧推',
  'incline press': '上斜推举',
  'decline press': '下斜推举',
  'hammer press': '锤式推举',
  'push press': '借力推举',
  'jerk press': '分腿推举',
  'log press': '圆木推举',
  'one arm press': '单臂推举',
  'single arm press': '单臂推举',
  'leg press': '腿举',
  'calf press': '小腿蹬伸',
  'hip press': '髋推',
  'smith press': '史密斯推举',
  // 拉 / 划船
  'lat pulldown': '高位下拉',
  'pulldown': '下拉',
  'pull down': '下拉',
  'pull-up': '引体向上',
  'pull up': '引体向上',
  'chin-up': '反握引体向上',
  'chin up': '反握引体向上',
  'muscle up': '双力臂',
  'muscle-up': '双力臂',
  'bent over row': '俯身划船',
  'upright row': '直立划船',
  'seated row': '坐姿划船',
  't-bar row': 'T 杠划船',
  'inverted row': '反向划船',
  'face pull': '面拉',
  'pull through': '胯下拉',
  'pullover': '仰卧上拉',
  'pull over': '仰卧上拉',
  'high pull': '高翻拉',
  'dead row': '硬拉划船',
  // 蹲 / 腿
  'front squat': '颈前深蹲',
  'back squat': '颈后深蹲',
  'full squat': '全蹲',
  'hack squat': '哈克深蹲',
  'sumo squat': '相扑深蹲',
  'goblet squat': '高脚杯深蹲',
  'split squat': '分腿蹲',
  'sissy squat': '西斯深蹲',
  'hack press': '哈克腿举',
  'leg extension': '腿屈伸',
  'leg curl': '腿弯举',
  'leg raise': '举腿',
  'leg lift': '举腿',
  'hip thrust': '臀推',
  'glute bridge': '臀桥',
  'hip bridge': '臀桥',
  'calf raise': '提踵',
  'toe raise': '勾脚尖',
  'heel raise': '提踵',
  'step up': '登台阶',
  'step-up': '登台阶',
  'step down': '下台阶',
  // 硬拉 / 奥举
  'romanian deadlift': '罗马尼亚硬拉',
  'stiff leg deadlift': '直腿硬拉',
  'straight leg deadlift': '直腿硬拉',
  'sumo deadlift': '相扑硬拉',
  'single leg deadlift': '单腿硬拉',
  'one leg deadlift': '单腿硬拉',
  'rack pull': '架上硬拉',
  'clean and jerk': '挺举',
  'clean and press': '翻站推举',
  'hang clean': '悬垂翻',
  'power clean': '高翻',
  'hang snatch': '悬垂抓举',
  'power snatch': '高抓',
  'good morning': '早安式挺身',
  // 手臂
  'biceps curl': '二头弯举',
  'bicep curl': '二头弯举',
  'hammer curl': '锤式弯举',
  'preacher curl': '牧师椅弯举',
  'concentration curl': '集中弯举',
  'wrist curl': '腕弯举',
  'wrist extension': '腕伸展',
  'reverse curl': '反握弯举',
  'spider curl': '蜘蛛弯举',
  'drag curl': '拖拽弯举',
  'zottman curl': '佐特曼弯举',
  'scott curl': '斯科特弯举',
  'arm curl': '臂弯举',
  'triceps extension': '三头臂屈伸',
  'tricep extension': '三头臂屈伸',
  'overhead extension': '过头臂屈伸',
  'skull crusher': '碎颅式',
  'french press': '法式推举',
  'kickback': '后踢',
  'pushdown': '下压',
  'push down': '下压',
  'close grip press': '窄握推举',
  'close-grip press': '窄握推举',
  // 肩 / 背
  'lateral raise': '侧平举',
  'front raise': '前平举',
  'rear delt raise': '后束平举',
  'rear delt fly': '后束飞鸟',
  'reverse fly': '反向飞鸟',
  'reverse flyes': '反向飞鸟',
  'shoulder shrug': '耸肩',
  'lateral pulldown': '侧向下拉',
  'straight arm pulldown': '直臂下拉',
  'chest fly': '飞鸟夹胸',
  'pec deck': '蝴蝶机夹胸',
  'cable crossover': '绳索夹胸',
  'cross over': '交叉夹胸',
  // 核心
  'sit up': '仰卧起坐',
  'sit-up': '仰卧起坐',
  'reverse crunch': '反向卷腹',
  'bicycle crunch': '自行车卷腹',
  'leg raise': '举腿',
  'hanging leg raise': '悬垂举腿',
  'russian twist': '俄罗斯转体',
  'mountain climber': '登山跑',
  'dead bug': '死虫式',
  'hollow hold': '空心支撑',
  'back extension': '山羊挺身',
  'hyperextension': '山羊挺身',
  'hip extension': '髋伸展',
  'hip flexion': '髋屈曲',
  'hip abduction': '髋外展',
  'hip adduction': '髋内收',
  'hip internal rotation': '髋内旋',
  'hip external rotation': '髋外旋',
  'side bend': '侧屈',
  'side bridge': '侧桥',
  'side plank': '侧平板支撑',
  'toe touch': '体前屈',
  'toe touchers': '体前屈',
  'jump squat': '深蹲跳',
  'jump lunge': '弓步跳',
  'jump rope': '跳绳',
  'jumping jack': '开合跳',
  'box jump': '跳箱',
  'broad jump': '立定跳远',
  'push up': '俯卧撑',
  'push-up': '俯卧撑',
  'knee push up': '跪姿俯卧撑',
  'diamond push up': '钻石俯卧撑',
  'pike push up': '派克俯卧撑',
  'handstand push up': '倒立俯卧撑',
  'rower': '划船机',
  'upright bike': '直立单车',
  'stationary bike': '健身车',
  'elliptical': '椭圆机',
  'stairmaster': '爬楼机',
  'stepmill': '爬楼机',
  'ski erg': '滑雪机',
  'assault bike': '风阻单车',
  'battle rope': '战绳',
  'sled push': '雪橇推',
  'sled pull': '雪橇拉',
  'farmer walk': "农夫行走",
  "farmer's walk": '农夫行走',
  'farmers walk': '农夫行走',
  'turkish get up': '土耳其起立',
  'turkish get-up': '土耳其起立',
  'kettlebell swing': '壶铃摆荡',
  'goblet': '高脚杯',
  'wall ball': '墙球',
  'slam ball': '砸球',
  'med ball': '药球',
  // 器械描述
  'ez barbell': 'EZ 杠铃',
  'olympic barbell': '奥杆',
  'trap bar': '六角杠',
  'stability ball': '瑞士球',
  'exercise ball': '健身球',
  'swiss ball': '瑞士球',
  'bosu ball': '波速球',
  'medicine ball': '药球',
  'resistance band': '阻力带',
  'body weight': '自重',
  'bodyweight': '自重',
  'leverage machine': '器械',
  'smith machine': '史密斯',
  'cable machine': '绳索',
  'ab wheel': '健腹轮',
  'wheel roller': '健腹轮',
  'ab roller': '健腹轮',
  'foam roller': '泡沫轴',
  'smr': '筋膜放松',
  'pec deck machine': '蝴蝶机',
};

/* ----------------------------- 单词表 ----------------------------- */
const TOKENS = {
  // 器械
  barbell: '杠铃', dumbbell: '哑铃', cable: '绳索', lever: '器械', machine: '器械',
  smith: '史密斯', kettlebell: '壶铃', band: '弹力带', assisted: '辅助', weighted: '负重',
  ball: '球', bench: '长凳', chair: '椅', box: '箱', board: '板', wall: '墙', floor: '地面',
  mat: '垫', rope: '绳', roller: '滚轴', wheel: '轮', sled: '雪橇', tire: '轮胎', tyre: '轮胎',
  plate: '杠铃片', bar: '杠', handle: '把手', attachment: '附件', pulley: '滑轮',
  strap: '带', towel: '毛巾', step: '台阶', platform: '台', spot: '保护',
  // 动作词
  curl: '弯举', press: '推举', raise: '上举', row: '划船', squat: '深蹲', lunge: '弓步',
  extension: '伸展', flexion: '屈曲', fly: '飞鸟', flyes: '飞鸟', pull: '拉', push: '推',
  pulldown: '下拉', pushdown: '下压', dip: '臂屈伸', dips: '臂屈伸', crunch: '卷腹',
  crunches: '卷腹', plank: '平板支撑', bridge: '桥', thrust: '推', kick: '踢',
  swing: '摆荡', clean: '翻', jerk: '挺', snatch: '抓举', shrug: '耸肩',
  walk: '行走', walking: '行走', run: '跑', running: '跑', jog: '慢跑',
  jump: '跳', jumps: '跳', hop: '跳', bounce: '弹跳', sprint: '冲刺', march: '踏步',
  rotation: '旋转', twist: '转体', twisting: '转体', stretch: '拉伸', stretchings: '拉伸',
  lift: '举', hold: '保持', drive: '驱动', crawl: '爬行', climb: '攀爬', climbing: '攀爬',
  deadlift: '硬拉', pullup: '引体向上', pullups: '引体向上', pullover: '仰卧上拉',
  sit: '坐', sitted: '坐姿', kneeling: '跪姿', standing: '站姿', lying: '仰卧',
  seated: '坐姿', prone: '俯卧', supine: '仰卧', hanging: '悬垂', suspended: '悬吊',
  seated: '坐姿', standing: '站姿', bent: '屈', bentover: '俯身', reverse: '反向',
  alternating: '交替', alternate: '交替', single: '单', double: '双', both: '双',
  one: '单', two: '双', three: '三', arm: '臂', arms: '臂', leg: '腿', legs: '腿',
  full: '全', half: '半', quarter: '四分之一', partial: '半程', complete: '完整',
  high: '高', low: '低', deep: '深', shallow: '浅',
  overhead: '过头', behind: '后', front: '前', rear: '后', side: '侧', lateral: '侧向',
  inner: '内', outer: '外', upper: '上', lower: '下', middle: '中',
  close: '窄', wide: '宽', narrow: '窄', grip: '握', neutral: '中立',
  overhand: '正握', underhand: '反握', pronated: '正握', supinated: '反握',
  parallel: '平行', straight: '直', bent: '屈', extended: '伸展', alternate: '交替',
  incline: '上斜', decline: '下斜', flat: '平', vertical: '垂直', horizontal: '水平',
  military: '军事', arnold: '阿诺德', preacher: '牧师椅', concentration: '集中',
  hammer: '锤式', skull: '碎颅', crusher: '式', french: '法式', spider: '蜘蛛',
  zottman: '佐特曼', scott: '斯科特', drag: '拖拽', kickback: '后踢', kickbacks: '后踢',
  // 身体
  chest: '胸', back: '背', shoulder: '肩', shoulders: '肩', bicep: '二头', biceps: '二头',
  tricep: '三头', triceps: '三头', calf: '小腿', calves: '小腿', glute: '臀', glutes: '臀',
  gluteus: '臀肌', hamstring: '腘绳肌', hamstrings: '腘绳肌', quad: '股四头', quads: '股四头',
  quadriceps: '股四头', abdominal: '腹', abdominals: '腹', abs: '腹', core: '核心',
  hip: '髋', hips: '髋', neck: '颈', wrist: '腕', wrists: '腕', forearm: '前臂',
  forearms: '前臂', spine: '脊柱', lat: '背阔肌', lats: '背阔肌', delt: '三角肌',
  delts: '三角肌', deltoid: '三角肌', deltoids: '三角肌', oblique: '腹斜肌',
  obliques: '腹斜肌', adductor: '内收肌', adductors: '内收肌', abductor: '外展肌',
  abductors: '外展肌', piriformis: '梨状肌', serratus: '前锯肌', rhomboid: '菱形肌',
  rhomboids: '菱形肌', trapezius: '斜方肌', traps: '斜方肌', levator: '提肌',
  scapula: '肩胛', rotator: '旋转肌', soleus: '比目鱼肌', brachialis: '肱肌',
  tibialis: '胫骨肌', peroneals: '腓骨肌', femoral: '股', rectus: '直', abdominis: '腹',
  sternum: '胸骨', pelvic: '骨盆', shoulderblade: '肩胛',
  // 性质 / 其它
  isometric: '等长', plyo: '爆发', explosive: '爆发', dynamic: '动态', static: '静态',
  negative: '退让', tempo: '节奏', max: '最大', maximum: '最大', speed: '速度',
  power: '力量', strength: '力量', endurance: '耐力', cardio: '有氧',
  warm: '热身', warmup: '热身', cool: '放松', coolup: '放松', mobility: '灵活性',
  stretchings: '拉伸', activation: '激活', stabilization: '稳定', balance: '平衡',
  functional: '功能性', compound: '复合', isolation: '孤立', assisted: '辅助',
  self: '自我', manual: '手动', partner: '搭档', towel: '毛巾',
  'reversegrip': '反握', 'clean-grip': '翻握', 'snatch-grip': '抓握',
  front: '前', rear: '后', side: '侧', under: '下方', over: '越过', through: '穿过',
  around: '环绕', across: '横跨', between: '之间', against: '靠', behind: '后',
  into: '进入', out: '外', up: '上', down: '下', in: '内', forward: '前', backward: '后',
  left: '左', right: '右', alternate: '交替', astride: '分腿', straddle: '分腿',
  straddle: '分腿', split: '分', short: '短', long: '长', stride: '步幅', quick: '快速',
  slow: '慢速', gentle: '轻柔', prone: '俯卧', supine: '仰卧', upright: '直立',
  reclining: '斜躺', leaning: '倾斜', supported: '支撑', padded: '软垫',
  // 数字 / 角度
  one: '单', two: '双', three: '三', four: '四', half: '半',
  '45': '45度', '90': '90度', '180': '180度', '360': '360度',
};


/* ----------------------------- 第二批补充（首轮未命中的词） ----------------------------- */
Object.assign(PHRASES, {
  'all fours': '四足跪姿',
  'air bike': '空中单车',
  'archer pull up': '弓箭手引体向上',
  'archer push up': '弓箭手俯卧撑',
  'arm slingers': '手臂甩摆',
  'heel touchers': '触脚跟',
  'heel toucher': '触脚跟',
  'battling ropes': '战绳',
  'bear crawl': '熊爬',
  'bottoms up': '底朝上',
  'captains chair': '船长椅',
  'spell caster': '施法者',
  'skin the cat': '猫式悬垂',
  'upward facing dog': '上犬式',
  'iron cross': '铁十字',
  'world greatest stretch': '世界最伟大拉伸',
  'back and forth': '前后',
  'front lever': '前水平',
  'pelvic tilt': '骨盆倾斜',
  'quick feet': '快速踏步',
  'rectus femoris': '股直肌',
  'pectoralis major': '胸大肌',
  'monster walk': '怪兽走',
  'frankenstein squat': '弗兰肯斯坦深蹲',
  'zercher squat': '泽奇深蹲',
  'pistol squat': '手枪深蹲',
  'cossack squats': '哥萨克深蹲',
  'cossack squat': '哥萨克深蹲',
  'hindu push up': '印度俯卧撑',
  'hindu push-up': '印度俯卧撑',
  'korean dips': '韩式双杠臂屈伸',
  'handstand push up': '倒立俯卧撑',
  'handstand push-up': '倒立俯卧撑',
  'janda sit up': '扬达仰卧起坐',
  'janda sit-up': '扬达仰卧起坐',
  'figure 8': '8 字绕',
  'figure eight': '8 字绕',
  '3 point stance': '三点支撑',
  '3/4 sit up': '四分之三仰卧起坐',
  '3/4 sit-up': '四分之三仰卧起坐',
  'half knee bends': '半蹲',
  'flutter kicks': '仰卧打水',
  'wind sprints': '冲刺跑',
  'skater hops': '滑冰跳',
  'star jump': '星形跳',
  'scissor jumps': '剪刀跳',
  'monster': '怪兽',
  'arm slinger': '手臂甩摆',
});

Object.assign(TOKENS, {
  '3/4': '四分之三', '3': '三点', '8': '8 字', '45°': '45 度', '45в°': '45 度',
  ab: '腹', above: '上方', advanced: '进阶', air: '空中', all: '全', angle: '角度',
  angled: '斜角', ankle: '踝', anti: '抗', apart: '分开', archer: '弓箭手', basic: '基础',
  battling: '战', bear: '熊', bends: '屈', big: '大', bike: '单车', body: '身体',
  bottoms: '底朝上', bowling: '保龄球', boxing: '拳击', bradford: '布拉德福德', burpee: '波比跳',
  butt: '臀', butterfly: '蝴蝶', cage: '架', cambered: '拱形', can: '罐', captains: '船长',
  carry: '负重行走', caster: '施法者', cat: '猫', catch: '接', chin: '下巴', circles: '绕环',
  circular: '绕环', clap: '击掌', clasped: '扣手', clock: '时钟', closer: '窄距', cobra: '眼镜蛇',
  cocoons: '茧式', contralateral: '对侧', cossack: '哥萨克', crab: '蟹式', cross: '交叉',
  crossover: '交叉', crossovers: '交叉', cuban: '古巴', curtsey: '屈膝礼', cycle: '单车',
  degrees: '度', depresor: '下压肌', depth: '深度', diagonal: '对角', dog: '犬',
  donkey: '驴式', drop: '递减', elbow: '肘', elevated: '抬高', elevator: '升降',
  ergometer: '功率车', external: '外旋', ez: 'EZ', face: '面', facing: '面向',
  fallout: '悬垂推出', feet: '足', femoris: '股', figure: '8 字', finger: '手指',
  fixed: '固定', flag: '人体旗帜', flexor: '屈肌', flip: '翻', flutter: '打水', forth: '前后',
  frankenstein: '弗兰肯斯坦', frog: '蛙式', gironda: '吉龙达', gorilla: '大猩猩',
  gravity: '重力', greatest: '最伟大', gripless: '空握', gripper: '握力器', groin: '腹股沟',
  ground: '地面', guillotine: '断头台', hack: '哈克', ham: '腘绳', hand: '手', hands: '手',
  handstand: '倒立', hang: '悬垂', head: '头', heel: '脚跟', hindu: '印度', hook: '勾拳',
  hug: '抱', hyght: '海特', hyper: '挺身', impossible: '不可能', inchworm: '毛毛虫',
  inside: '内侧', intermediate: '中级', internal: '内旋', inverse: '反向', iron: '铁',
  jack: '开合', jackknife: '折刀', janda: '扬达', jefferson: '杰斐逊', jm: 'JM',
  judo: '柔道', kayak: '皮划艇', keens: '膝', kipping: '摆荡', knee: '膝', knees: '膝',
  knife: '刀', korean: '韩式', l: 'L 字', landmine: '地雷管', legged: '腿', lifting: '抬',
  london: '伦敦', major: '大', maltese: '马耳他', mixed: '混合', modified: '改良',
  monster: '怪兽', motion: '动作', multiple: '多次', off: '离', otis: '奥蒂斯',
  outside: '外侧', outstretched: '伸直', pallof: '帕洛夫', palm: '掌', palms: '掌',
  pass: '传递', peacher: '牧师椅', pec: '胸', pectoralis: '胸大肌', pendlay: '彭德雷',
  pike: '派克', pin: '架上', pirate: '海盗', pistol: '手枪', planche: '俄挺', plus: '加',
  point: '点', pose: '姿势', position: '位置', posterior: '后侧', potty: '蹲式',
  presses: '推举', prisoner: '囚徒', pronate: '正握', pronation: '旋前', raised: '抬起',
  range: '幅度', reach: '伸展', release: '释放', renegade: '叛徒', reps: '次',
  response: '多次', retractor: '后缩肌', revers: '反向', reversed: '反向', ring: '吊环',
  rocking: '摇动', rocky: '洛奇', rollerer: '滚轴', rollerout: '滚出', rotary: '旋转',
  rotate: '旋转', rotational: '旋转', round: '圆', runners: '跑者', russian: '俄罗斯',
  saw: '拉锯', scapular: '肩胛', scissor: '剪刀', seesaw: '跷跷板', semi: '半',
  sequence: '序列', skater: '滑冰', ski: '滑雪', skier: '滑雪者', skullcrusher: '碎颅式',
  slam: '砸', sledge: '大锤', slide: '滑', slingers: '甩摆', spell: '施法',
  sphinx: '狮身人面', squad: '股四头', squatting: '深蹲', squeeze: '夹', stalder: '施塔尔德',
  stance: '站距', star: '星形', stepbox: '踏板', stiff: '直', stork: '鹭鸶', sumo: '相扑',
  superman: '超人式', supination: '旋后', supper: '海盗船', support: '支撑', svend: '斯文德',
  swimmer: '游泳', t: 'T 字', tap: '轻触', tate: '泰特', thibaudeau: '蒂博多', throw: '抛',
  thruster: '推举蹲', tilt: '倾斜', toe: '脚尖', touch: '触', touchers: '触', trainer: '训练器',
  treadmill: '跑步机', tuck: '收腹', twin: '双', twisted: '转体', unilateral: '单侧',
  upward: '向上', variation: '变式', w: 'W 字', waiter: '侍者', wind: '冲刺',
  windmill: '风车', lean: '前倾', hook: '勾拳', wipers: '雨刷', world: '世界', y: 'Y 字', yoga: '瑜伽', zercher: '泽奇',
});


/* ----------------------------- 第三批：语序与固定搭配修正 ----------------------------- */
Object.assign(PHRASES, {
  'external rotation': '外旋',
  'internal rotation': '内旋',
  'hands behind head': '双手抱头',
  'behind head': '头后',
  'standing up': '站姿',
  'on the wall': '（靠墙）',
  'on bench': '（长凳）',
  'on exercise ball': '（健身球）',
  'on stability ball': '（瑞士球）',
  'on bosu ball': '（波速球）',
  'on the floor': '（地面）',
  'rear delt': '后束',
  'rear delts': '后束',
  'v sit': 'V 字坐姿',
  'cross body': '交叉触肘',
  'wide military press': '宽握军事推举',
  'arms apart': '双臂分开',
  'single arm': '单臂',
  'one arm': '单臂',
  'single leg': '单腿',
  'one leg': '单腿',
  'both arms': '双臂',
  'both legs': '双腿',
  'close grip': '窄握',
  'wide grip': '宽握',
  'reverse grip': '反握',
  'neutral grip': '对握',
  'mixed grip': '混合握',
  'overhand grip': '正握',
  'underhand grip': '反握',
  'full range of motion': '全幅度',
  'on dip cage': '（双杠架）',
  'with support': '（有支撑）',
  'with rope': '（绳）',
  'rope attachment': '绳把',
  'with rope attachment': '绳把',
  'with handle': '把手',
  'arm straight': '手臂伸直',
  'arms straight': '手臂伸直',
  'with band': '（弹力带）',
  'on incline bench': '（上斜凳）',
  'incline bench row': '上斜划船',
  'hands against wall': '手扶墙',
  'against wall': '（扶墙）',
  'chest dip': '双杠臂屈伸',
  'v bar': 'V 字把',
  'inner biceps': '内侧二头',
  'outer biceps': '外侧二头',
  'arm blaster': '臂托',
  'with arm blaster': '（臂托）',
  'on hip': '（髋部）',
  'on knees': '（跪姿）',
});

Object.assign(TOKENS, {
  external: '外', internal: '内', rotation: '旋转',
  twice: '两次', half: '半', alternate: '交替',
});

/* 直接丢弃的函数词 */
const DROP = new Set([
  'on', 'in', 'at', 'with', 'to', 'from', 'of', 'and', 'the', 'a', 'an', 'for',
  'v.', 'v', 'version', 'male', 'female', 'pov', 'back', 'view', 'both', 'by',
]);

const PAREN_DROP = /^(male|female|male\s*&?\s*female)$/i;

function normalize(name) {
  let s = name.toLowerCase();
  s = s.replace(/\((male|female)\)/gi, ' ');
  s = s.replace(/\bv\.?\s*\d+\b/gi, ' ');
  s = s.replace(/\bpov\b/gi, ' ');
  s = s.replace(/_/g, ' ');
  s = s.replace(/-/g, ' ');
  s = s.replace(/[.,;:!?'"]/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

/** 贪心最长匹配：先整短语，再单词 */
function translatePhrase(words, unknown) {
  const out = [];
  let i = 0;
  while (i < words.length) {
    let matched = false;
    for (let len = Math.min(5, words.length - i); len >= 2; len--) {
      const key = words.slice(i, i + len).join(' ');
      if (PHRASES[key]) {
        out.push(PHRASES[key]);
        i += len;
        matched = true;
        break;
      }
    }
    if (matched) continue;

    const w = words[i];
    if (DROP.has(w)) {
      i++;
      continue;
    }
    if (PHRASES[w]) {
      out.push(PHRASES[w]);
    } else if (TOKENS[w]) {
      out.push(TOKENS[w]);
    } else {
      // 尝试去掉结尾 s
      const singular = w.replace(/s$/, '');
      if (TOKENS[singular]) {
        out.push(TOKENS[singular]);
      } else {
        out.push(w);
        unknown.push(w);
      }
    }
    i++;
  }
  return out;
}

function translateName(raw) {
  const unknown = [];
  // 拆出括号内容
  const parens = [];
  const base = raw.replace(/\(([^)]*)\)/g, (_, inner) => {
    parens.push(inner);
    return ' ';
  });

  const words = normalize(base).split(' ').filter(Boolean);
  const zh = translatePhrase(words, unknown).join('');

  // 括号内容：翻译成功才保留
  const zhParens = [];
  for (const p of parens) {
    if (PAREN_DROP.test(p.trim())) continue;
    const pw = normalize(p).split(' ').filter(Boolean);
    if (!pw.length) continue;
    const pu = [];
    const pz = translatePhrase(pw, pu).join('');
    if (pu.length === 0 && pz) zhParens.push(pz.replace(/[（）]/g, ''));
  }

  const full = zh + zhParens.map((p) => `（${p}）`).join('');
  return { zh: full, unknown };
}

/* ----------------------------- 人工修正（数据集里的拼写错误 / 语义特例） ----------------------------- */
const MANUAL = {
  'hug keens to chest': '抱膝至胸',
  'gironda sternum chin': '吉龙达胸骨引体',
  'arms apart circular toe touch (male)': '双臂分开绕环体前屈',
  'cable standing up straight crossovers': '绳索站姿直臂交叉',
  'exercise ball back extension with hands behind head': '健身球山羊挺身（双手抱头）',
  'cross body crunch': '交叉触肘卷腹',
  'dumbbell incline breeding': '上斜哑铃卧推', // 原始名字拼写有误，中文说明描述的是上斜卧推
  'left hook. boxing': '左勾拳（拳击）',
  'lean planche': '前倾俄挺',
  'arm slingers hanging bent knee legs': '手臂甩摆悬垂屈膝',
  'arm slingers hanging straight legs': '手臂甩摆悬垂直腿',
  'hands reversed clasped circular toe touch (male)': '反手扣手绕环体前屈',
};

/* ----------------------------- 主流程 ----------------------------- */
const exercises = JSON.parse(fs.readFileSync(path.join('data', 'exercises.json'), 'utf8'));

const results = exercises.map((x) => {
  const manual = MANUAL[x.name];
  if (manual) return { id: x.id, en: x.name, zh: manual, status: 'ok', unknowns: [] };
  const { zh, unknown } = translateName(x.name);
  return {
    id: x.id,
    en: x.name,
    zh: zh || x.name,
    status: unknown.length ? 'partial' : 'ok',
    unknowns: [...new Set(unknown)],
  };
});

const ok = results.filter((r) => r.status === 'ok').length;
const partial = results.filter((r) => r.status === 'partial');

fs.writeFileSync(path.join('data', 'exercise-zh.json'), JSON.stringify(results));

console.log(`总数 ${results.length}｜完全译出 ${ok}（${((ok / results.length) * 100).toFixed(1)}%）｜待补 ${partial.length}`);

// 统计未命中的词
const freq = {};
for (const r of partial) for (const w of r.unknowns) freq[w] = (freq[w] || 0) + 1;
const top = Object.entries(freq).sort((a, b) => b[1] - a[1]);
console.log(`\n未命中词 ${top.length} 个，Top 40：`);
console.log(top.slice(0, 40).map(([w, c]) => `${w}(${c})`).join('  '));

console.log('\n示例：');
for (const r of results.slice(0, 12)) console.log(`${r.en.padEnd(46)} → ${r.zh}`);
if (partial.length) {
  console.log('\npartial 示例：');
  for (const r of partial.slice(0, 15)) console.log(`${r.en.padEnd(46)} → ${r.zh}  [${r.unknowns.join(',')}]`);
}
