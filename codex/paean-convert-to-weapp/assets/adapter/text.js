// One line breaker for both intrinsic measurement and painting. Fractional
// widths must survive layout: rounding 98.16 to 98 can wrap a whole word.
export function textMetrics(ctx, text, style, width = Infinity) {
  const size = parseFloat(style['font-size']) || 16;
  ctx.font = `${style['font-style'] || 'normal'} ${style['font-weight'] || 400} ${size}px ${style['font-family'] || 'sans-serif'}`;
  if (style['text-transform'] === 'uppercase') text = text.toUpperCase();
  if (style['text-transform'] === 'lowercase') text = text.toLowerCase();
  const spacing = parseFloat(style['letter-spacing']) || 0;
  const letter = style['letter-spacing']?.endsWith('em') ? spacing * size : spacing;
  const measure = value => ctx.measureText(value).width + Math.max(0, [...value].length - 1) * letter;
  const lineHeight = style['line-height'] === 'normal' || !style['line-height'] ? size * 1.2 : parseFloat(style['line-height']) * (style['line-height'].endsWith('px') ? 1 : size);
  const words = text.split(/(?<=\s)|(?<=[\u3000-\u9fff])/);
  const lines = []; let current = '';
  for (const word of words) {
    if (current && measure((current + word).trimEnd()) > width + 0.01 && style['white-space'] !== 'nowrap') {
      lines.push(current.trim()); current = word.trimStart();
    } else current += word;
  }
  if (current) lines.push(current.trim());
  return {text, size, letter, measure, lines, lineHeight, natural: measure(text), min: Math.max(0, ...words.map(w => measure(w.trim())))};
}

export function measureText(ctx, text, style, known, available) {
  const natural = textMetrics(ctx, text, style);
  const limit = available.width === 'min-content' ? natural.min : typeof available.width === 'number' ? available.width : natural.natural;
  const width = known.width ?? Math.min(natural.natural, limit);
  const lines = textMetrics(ctx, text, style, width);
  return {width, height: known.height ?? Math.max(1, lines.lines.length) * lines.lineHeight};
}
