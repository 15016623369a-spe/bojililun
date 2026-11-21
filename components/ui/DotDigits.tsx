/** 5×7 点阵字形，只用于计时、读秒和语音录制（见视觉系统稿「点阵数字」）。 */
const GLYPHS: Record<string, string[]> = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  ':': ['0', '0', '1', '0', '1', '0', '0'],
  '.': ['0', '0', '0', '0', '0', '0', '1'],
  ' ': ['0', '0', '0', '0', '0', '0', '0'],
};

/** 点阵数字。dimFrom 之后的字符用中灰，和大号数字「前段墨黑、后段中灰」的排印一致。 */
export default function DotDigits({ text, cell = 9, dimFrom, ink = 'var(--ink-0)', dim = '#8b8d87', off = 'rgb(21 22 19 / 10%)', label }: {
  text: string;
  cell?: number;
  dimFrom?: number;
  ink?: string;
  dim?: string;
  off?: string;
  label?: string;
}) {
  const dots: React.ReactNode[] = [];
  let x = 0;
  [...text].forEach((ch, index) => {
    const glyph = GLYPHS[ch] ?? GLYPHS[' '];
    const width = glyph[0].length;
    glyph.forEach((row, y) => [...row].forEach((bit, col) => {
      const cx = (x + col) * cell + cell / 2, cy = y * cell + cell / 2;
      const on = bit === '1';
      dots.push(<circle key={`${index}-${y}-${col}`} cx={cx} cy={cy} r={cell * (on ? .4 : .12)}
        fill={on ? (dimFrom !== undefined && index >= dimFrom ? dim : ink) : off} />);
    }));
    x += width + 1;
  });
  const w = Math.max(0, (x - 1) * cell), h = 7 * cell;
  return <svg className="dot-digits" width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label ?? text}>{dots}</svg>;
}
