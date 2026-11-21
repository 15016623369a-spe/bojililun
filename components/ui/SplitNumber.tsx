/** 大号读数：前段墨黑，末两位降为中灰（如 2,8|40），和设计稿的数字排印一致。 */
export default function SplitNumber({ value, className = 'big-num', tail = 2 }: { value: number; className?: string; tail?: number }) {
  const text = Math.round(value).toLocaleString('en-US');
  if (value < 100) return <b className={className}>{text}</b>;
  let digits = 0, cut = text.length;
  while (cut > 0 && digits < tail) { cut -= 1; if (/\d/.test(text[cut])) digits += 1; }
  return <b className={className}>{text.slice(0, cut)}<span className="dim">{text.slice(cut)}</span></b>;
}
