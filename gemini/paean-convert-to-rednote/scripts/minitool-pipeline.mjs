/*
 * minitool-pipeline.mjs — the RedNote mini-tool build pipeline.
 *
 * Takes an adapted source tree and produces a container-legal offline zip:
 *   - bundles ES modules (or concatenates classic scripts) to one classic ES2017 script
 *   - lowers CSS to the Chrome 61 baseline (flex gap, min()/max()/clamp() incl. inside
 *     shorthands, logical properties, env(), color-mix(), dvh/svh/lvh)
 *   - prepends a Chrome 61 API shim (Object.fromEntries, AbortController, flatMap,
 *     roundRect, structuredClone, ResizeObserver degradation, ...)
 *   - inlines third-party licence text into index.html (".txt" cannot ship)
 *   - static self-check for container-forbidden APIs, then zips
 *
 * Used by build-minitool.mjs; also importable directly if a work needs a custom
 * `cssFix` or a generated `html`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createZip } from './zip.mjs';
/* esbuild is this skill's one external dependency — it does the ESM→IIFE bundling and the
   chrome61 CSS lowering. Everything else here is plain Node.

   Resolution matters: this script usually lives OUTSIDE the project (in the skill folder),
   so a bare `import('esbuild')` would only look next to the skill, not next to the work
   the user actually ran `npm i -D esbuild` in. Try the project root first, then fall back
   to the skill's own neighbourhood, then to a global install. */
let esbuild;
async function loadEsbuild(projectRoot) {
  if (esbuild) return esbuild;
  const roots = [];
  if (projectRoot) roots.push(path.resolve(projectRoot));
  roots.push(path.dirname(fileURLToPath(import.meta.url)));
  const tried = [];
  for (const r of roots) {
    let dir = r;
    for (;;) {
      const cand = path.join(dir, 'node_modules', 'esbuild');
      if (fs.existsSync(cand)) {
        tried.push(cand);
        try { esbuild = await import(pathToFileURL(path.join(cand, 'lib', 'main.js')).href); return esbuild; } catch (e) { /* keep looking */ }
      }
      const up = path.dirname(dir);
      if (up === dir) break;
      dir = up;
    }
  }
  try { esbuild = await import('esbuild'); return esbuild; } catch (e) { /* fall through */ }
  throw new Error(
    'esbuild is required by the mini-tool pipeline but was not found.\n' +
    '  install it next to your project:  npm i -D esbuild\n' +
    '  (searched upward from ' + roots.join(' and from ') + ')'
  );
}


export const TARGET = ['es2017', 'chrome61'];

const ALLOWED_EXT = new Set(['.html', '.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.woff', '.woff2', '.json']);

// Patterns from minitool-zip-builder references (zip-artifact-spec §3/§6, device-capabilities §7).
const FORBIDDEN = [
  ['external url', /(src|href)=["']https?:\/\//], ['css external url', /url\(\s*["']?https?:\/\//],
  ['module script', /type=["']module["']/], ['inline script', /<script(?![^>]*\bsrc=)[^>]*>[^<]*\S[^<]*<\/script>/],
  ['inline handler', /\son(?:click|load|error|change|input|submit|focus|blur|key[a-z]+|mouse[a-z]+|touch[a-z]+|pointer[a-z]+|animation[a-z]+|transition[a-z]+|drag[a-z]*|drop|scroll|wheel|contextmenu|select|toggle|abort|play|pause|ended|resize)\s*=["']/i], ['javascript: uri', /["']javascript:/i],
  ['eval', /\beval\s*\(/], ['new Function', /new Function\s*\(/], ['WebAssembly', /WebAssembly\./],
  ['fetch', /\bfetch\s*\(/], ['XMLHttpRequest', /XMLHttpRequest/], ['WebSocket', /new WebSocket\s*\(/],
  ['EventSource', /new EventSource\s*\(/], ['RTCPeerConnection', /RTCPeerConnection/],
  ['Worker', /new (Shared)?Worker\s*\(/], ['serviceWorker', /serviceWorker\.register/],
  ['window.open', /window\.open\s*\(/], ['window.prompt', /window\.prompt\s*\(/],
  ['requestFullscreen', /requestFullscreen/], ['clipboard', /navigator\.clipboard/], ['execCommand', /execCommand\s*\(\s*["'](copy|cut|paste)/],
  ['geolocation', /geolocation/], ['device sensors', /Device(Motion|Orientation)Event|['"]device(motion|orientation)['"]/],
  ['navigator hardware', /navigator\.(bluetooth|usb|hid|serial|getBattery|connection|credentials|locks)\b/],
  ['storage.persist', /storage\.persist\s*\(/], ['display media', /getDisplayMedia|enumerateDevices/],
  ['location jump', /location\.(assign|replace)\s*\(|location\.href\s*=/],
  ['import statement', /^\s*import\s.+from\s/m], ['export statement', /^\s*export\s/m],
  ['ES2020 optional chaining', /[a-zA-Z_)\]]\?\.[a-zA-Z_[(]/], ['ES2020 nullish', /[)\]\w]\s*\?\?\s*[\w(\[]/],
  ['base tag', /<base\s/], ['iframe/object', /<(iframe|object)[\s>]/], ['download link', /<a[^>]*\sdownload[\s>=]/],
  ['target=_blank', /target=["']_blank["']/], ['csp meta', /http-equiv=["']Content-Security-Policy/],
];

export const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const sizeOf = (f) => fs.statSync(f).size;

/** Flex gap fallback layer: Chrome 61 has no flex gap, so emit `html.no-flex-gap <sel> > * + *` margins. */
export function gapFallbacks(text) {
  /* 小工具 build: 回退层必须**按断点分别生成**，而且要看该断点下**最终生效**的 display。
   *
   * 早先的实现有两个静默错误：
   *   1) 只认"同一条规则里同时写了 display:flex 和 gap"。响应式写法通常在媒体查询里只覆盖
   *      `gap:`（不重复 display），这些覆盖要么看不见、要么被拿去无条件套到所有断点上 ——
   *      桌面拿到手机的间距，或反过来。
   *   2) 生成的层平铺在样式表末尾、不带媒体查询，所以就算值取对了也会跨断点生效。
   * 另有一个细节：`gap` 不给 `display:none` 的 flex item 留空档，但 `> * + *` 会照给
   *      后继元素加 margin —— 窄屏隐藏图标后会凭空多出一段缩进。这里对该断点下
   *      display 不是 flex 的选择器直接不发回退。
   */
  const ctxs = new Map();            // 媒体查询前奏（'' = 基础层）→ Map<选择器, 状态>
  const re = /(@media[^{]+\{)|([^{}@]+)\{([^{}]*)\}|(\})/g;
  const stack = [];
  let m;
  while ((m = re.exec(text))) {
    if (m[1]) { stack.push(m[1].replace(/\{$/, '').trim()); continue; }
    if (m[4]) { stack.pop(); continue; }
    const sel = (m[2] || '').trim(), body = m[3] || '';
    if (!sel || sel.startsWith('@') || sel.includes('no-flex-gap')) continue;
    const key = stack.join(' and ');
    if (!ctxs.has(key)) ctxs.set(key, new Map());
    const map = ctxs.get(key);
    const cur = map.get(sel) || {};
    const disp = /display\s*:\s*([a-z-]+)/.exec(body);
    if (disp) cur.display = disp[1];
    const gap = /(?:^|;)\s*(?:row-)?gap\s*:\s*([^;]+)/.exec(body);
    if (gap) cur.gap = gap[1].trim();
    if (/flex-direction\s*:\s*([a-z-]+)/.test(body)) cur.dir = /flex-direction\s*:\s*([a-z-]+)/.exec(body)[1];
    if (/flex-wrap\s*:\s*([a-z-]+)/.test(body)) cur.wrap = /flex-wrap\s*:\s*([a-z-]+)/.exec(body)[1];
    map.set(sel, cur);
  }

  const base = ctxs.get('') || new Map();
  const emit = (map, prelude) => {
    const lines = [];
    for (const [sel, own] of map) {
      // 该断点下最终生效的状态 = 基础层 + 本断点覆盖
      const b = base.get(sel) || {};
      const st = { ...b, ...own };
      if (!st.gap) continue;
      const sels0 = sel.split(',').map((x) => 'html.no-flex-gap ' + x.trim() + ' > * + *').join(', ');
      if (!/^(inline-)?flex$/.test(st.display || '')) {
        /* 该断点下已经不是 flex 了（例如窄屏改成 display:block）。基础层那条 margin
           不会自己消失，必须在这个断点里显式归零，否则会凭空多出一段缩进。 */
        if (prelude && /^(inline-)?flex$/.test(b.display || '')) lines.push(`${sels0} { margin-left: 0; margin-top: 0; }`);
        continue;
      }
      const parts = String(st.gap).split(/\s+/);
      const rowGap = parts[0], colGap = parts[1] || parts[0];
      const sels = sel.split(',').map((x) => 'html.no-flex-gap ' + x.trim() + ' > * + *').join(', ');
      /* 只发真正需要的那一侧。多发一条 `margin-left: 0` 看似无害，实则会打掉子项自己写的
         `margin: X auto` 居中（只剩另一侧 auto，元素被顶到容器一端）—— 页面不报错、
         探针也扫不出来，只在 no-flex-gap 档整块偏到一边。默认值本来就是 0，不需要显式清零；
         只有在**同一选择器换了主轴方向**时，才需要把上一个断点设过的那一侧归零。 */
      const flipped = prelude && base.get(sel) && /^(inline-)?flex$/.test((base.get(sel).display) || '')
        && (base.get(sel).dir === 'column') !== (st.dir === 'column');
      if (st.dir === 'column') {
        lines.push(`${sels} { margin-top: ${rowGap};${flipped ? ' margin-left: 0;' : ''} }`);
        continue;
      }
      if (st.wrap === 'wrap') {
        /* 换行容器不能只给 `> * + *` 发 margin-top —— 那样同一行里**第 1 项**没有上边距、
           其余项有，一行之内就错开一个行距（不是"阶梯"，是第一项单独高出去）。
           改用标准的负边距法：所有子项统一上边距，容器自身抵消掉多出来的那一份。 */
        const allKids = sel.split(',').map((x) => 'html.no-flex-gap ' + x.trim() + ' > *').join(', ');
        const conts = sel.split(',').map((x) => 'html.no-flex-gap ' + x.trim()).join(', ');
        lines.push(`${sels} { margin-left: ${colGap}; }`);
        lines.push(`${allKids} { margin-top: ${rowGap}; }`);
        lines.push(`${conts} { margin-top: -${rowGap}; }`);
        continue;
      }
      lines.push(`${sels} { margin-left: ${colGap};${flipped ? ' margin-top: 0;' : ''} }`);
    }
    if (!lines.length) return '';
    return prelude ? `@media ${prelude} {\n${lines.join('\n')}\n}` : lines.join('\n');
  };

  const out = [emit(base, '')];
  for (const [prelude, map] of ctxs) {
    if (!prelude) continue;
    // 只为"在这个断点里确实改了 gap / display / 方向 / 换行"的选择器重发
    const changed = new Map();
    for (const [sel, own] of map)
      if (own.gap || own.display || own.dir || own.wrap) changed.set(sel, own);
    if (changed.size) out.push(emit(changed, prelude.replace(/^@media\s*/, '')));
  }
  return out.filter(Boolean).join('\n');
}

/** Chrome 61 has no min()/max()/clamp(): emit a static declaration before each one.
 *  min(A, B) on width/height → "prop: A; max-prop: B" (A fluid, B the px cap); otherwise the px argument.
 *  max(A, B) → the px argument (+ min-prop); clamp(a, b, c) → the middle (fluid) argument. */
/** 把值里**每一个** min()/max()/clamp() 换成静态回落值；nested 也处理。查不出就返回 null。 */
function flattenMath(value) {
  let out = value, guard = 0;
  while (/\b(min|max|clamp)\(/.test(out)) {
    if (++guard > 12) return null;                  // 防御畸形输入
    const next = nestedMathFallback(out);
    if (!next || next === out) return null;
    out = next;
  }
  return out;
}

export function cssMathFallbacks(text) {
  return text.replace(/(^|[;{\s])([a-z-]+)\s*:\s*([^;{}]*\b(?:min|max|clamp)\([^;{}]*)(?=;|\})/g, (all, pre, prop, value) => {
    if (/^(--|font-family)/.test(prop) || /calc\([^)]*\b(min|max|clamp)\(/.test(value)) return all;
    const m = /^(min|max|clamp)\(([^()]*)\)$/.exec(value.trim());
    if (m) {
      // 整个值就是一个扁平 math 函数：按属性语义给更贴切的回落（width/height 可用 min-/max- 配对）
      const fn = m[1], args = m[2].split(',').map((a) => a.trim());
      const px = args.find((a) => /px$/.test(a));
      let fallback = '';
      if (fn === 'clamp' && args.length === 3) fallback = `${prop}:${args[1]};`;
      else if (fn === 'min' && (prop === 'width' || prop === 'height') && px) {
        const fluid = args.find((a) => a !== px) || px;
        fallback = `${prop}:${fluid};max-${prop}:${px};`;
      } else if (fn === 'max' && (prop === 'width' || prop === 'height') && px) {
        const fluid = args.find((a) => a !== px) || px;
        fallback = `${prop}:${fluid};min-${prop}:${px};`;
      } else fallback = `${prop}:${px || args[0]};`;
      return pre + fallback + prop + ':' + value;
    }
    /* 小工具 build: math 函数夹在 shorthand 里（padding: 36px clamp(24px,5vw,80px)）或嵌套时，
       上面那条整值正则匹配不到。Chrome 61 不认 clamp()，**整条声明会被丢掉** ——
       页面不会报错，只是内边距/间距整个消失，探针也看不出来。这里把值里每个 math 函数
       逐个摊平成静态值，作为前置回落声明，再保留原声明给新内核。 */
    const flat = flattenMath(value.trim());
    if (!flat || flat === value.trim()) return all;
    return pre + prop + ':' + flat + ';' + prop + ':' + value;
  });
}

/** PC 模拟器 injects --safe-area-inset-* instead of env(): wrap every env() so both work (cross-platform-h5 §3). */
export function cssSafeArea(text) {
  /* 小工具 build: 只改写声明里的 env()，**跳过 @supports 的条件部分**。
     条件里的 env() 一旦被改写成 var(--x, env(...))，Chrome 61 认识 var()，
     `@supports (padding: env(safe-area-inset-top))` 就恒为 true ——
     作者写的特性检测静默失效，老内核会走进本该跳过的分支。 */
  const rewrite = (chunk) => chunk.replace(
    /(?<!var\(--safe-area-inset-(?:top|bottom|left|right),\s*)env\(safe-area-inset-(top|bottom|left|right)(?:\s*,\s*([^)]+))?\)/g,
    (all, side, def) => `var(--safe-area-inset-${side}, env(safe-area-inset-${side}, ${def || '0px'}))`);

  let out = '', i = 0;
  const re = /@supports[^{]*/g; let m;
  while ((m = re.exec(text))) {
    out += rewrite(text.slice(i, m.index));   // 普通区段照常改写
    out += m[0];                              // @supports 条件原样保留
    i = m.index + m[0].length;
  }
  return out + rewrite(text.slice(i));
}

/** Scan a declaration value for a top-level min()/max()/clamp() that the flat matcher above
 *  cannot see (nested calc()/var()), and emit a static first value so Chrome 61 keeps something.
 *  clamp(a,b,c) → a · min/max(...) → the px argument, else the first one. */
function nestedMathFallback(value) {
  const i = value.search(/\b(min|max|clamp)\(/);
  if (i < 0) return null;
  const fn = /\b(min|max|clamp)\(/.exec(value.slice(i))[1];
  let depth = 0, start = i + fn.length, end = -1;
  for (let k = start; k < value.length; k++) {
    if (value[k] === '(') depth++;
    else if (value[k] === ')') { depth--; if (depth === 0) { end = k; break; } }
  }
  if (end < 0) return null;
  const inner = value.slice(start + 1, end);
  const args = []; let d = 0, last = 0;
  for (let k = 0; k < inner.length; k++) {
    if (inner[k] === '(') d++;
    else if (inner[k] === ')') d--;
    else if (inner[k] === ',' && d === 0) { args.push(inner.slice(last, k).trim()); last = k + 1; }
  }
  args.push(inner.slice(last).trim());
  const pick = fn === 'clamp' ? args[0] : (args.find((a) => /^[\d.]+px$/.test(a)) || args[0]);
  if (!pick || /\b(min|max|clamp)\(/.test(pick)) return null;
  return value.slice(0, i) + pick + value.slice(end + 1);
}

/** Chrome 61 (and everything before Chrome 111) has no color-mix(): the whole declaration is
 *  dropped, so a border or shadow painted with one simply disappears. Substitute a flat colour —
 *  the mix's own first colour, which is the accent the author was tinting. */
function colorMixFallback(value) {
  const i = value.indexOf('color-mix(');
  if (i < 0) return null;
  let depth = 0, start = i + 'color-mix'.length, end = -1;
  for (let k = start; k < value.length; k++) {
    if (value[k] === '(') depth++;
    else if (value[k] === ')') { depth--; if (depth === 0) { end = k; break; } }
  }
  if (end < 0) return null;
  const inner = value.slice(start + 1, end);
  const args = []; let d = 0, last = 0;
  for (let k = 0; k < inner.length; k++) {
    if (inner[k] === '(') d++;
    else if (inner[k] === ')') d--;
    else if (inner[k] === ',' && d === 0) { args.push(inner.slice(last, k).trim()); last = k + 1; }
  }
  args.push(inner.slice(last).trim());
  const colours = args.slice(1).map((a) => a.replace(/\s+-?[\d.]+%\s*$/, '').trim());
  const pick = colours.find((c) => c && c !== 'transparent') || colours[0];
  if (!pick || /color-mix\(/.test(pick)) return null;
  return value.slice(0, i) + pick + value.slice(end + 1);
}

/** Chrome 61 has neither dvh/svh/lvh nor nested math functions, and esbuild collapses the
 *  "same property twice" fallbacks authors write by hand. This runs AFTER the bundle, so the
 *  twin declaration it emits survives into the shipped CSS (css-compatibility §2, §4). */
/* 小工具 build: Chrome 61 不认逻辑属性（margin-inline / padding-block / border-inline-start …）。
   esbuild 只会拆 `inset`，其余原样输出 —— 整条声明在旧内核上被丢掉，页面不报错、只是间距没了。
   本作只做 ltr，所以 inline→left/right、block→top/bottom 是等价的。 */
const LOGICAL_AXIS = { inline: ['left', 'right'], block: ['top', 'bottom'] };
const LOGICAL_EDGE = { 'inline-start': 'left', 'inline-end': 'right', 'block-start': 'top', 'block-end': 'bottom' };

function logicalFallback(prop, value) {
  const m = /^(margin|padding|border|scroll-margin|scroll-padding)-(inline|block)(?:-(start|end))?$/.exec(prop);
  if (!m) return null;
  const [, base, axis, edge] = m;
  // !important 要原样带到每条回落上，不能当成值的一部分参与拆分
  let v = value.trim(), bang = '';
  const bm = /\s*!important\s*$/i.exec(v);
  if (bm) { bang = ' !important'; v = v.slice(0, bm.index).trim(); }
  if (edge) {
    const side = LOGICAL_EDGE[axis + '-' + edge];
    return base === 'border' ? `border-${side}:${v}${bang};` : `${base}-${side}:${v}${bang};`;
  }
  const [s1, s2] = LOGICAL_AXIS[axis];
  // border-inline / border-block 的值是**一整条 border 简写**（宽度 样式 颜色），
  // 不是"起始值 结束值"，绝不能按空格拆 —— 拆了会拼出 border-bottom:solid 这种垃圾。
  if (base === 'border') return `border-${s1}:${v}${bang};border-${s2}:${v}${bang};`;
  // margin/padding 的简写才是 1 个值（两边相同）或 2 个值（起始/结束）
  const parts = v.split(/\s+/);
  const a = parts[0], b = parts.length > 1 ? parts[1] : parts[0];
  return `${base}-${s1}:${a}${bang};${base}-${s2}:${b}${bang};`;
}

export function cssLatePropertyFallbacks(text) {
  return text.replace(/(^|[;{\s])([a-z-]+)\s*:\s*([^;{}]+?)(?=\s*[;}])/g, (all, pre, prop, value) => {
    if (prop.startsWith('--')) return all;
    let fallback = value;
    // Flat min()/max()/clamp() already got a fallback from cssMathFallbacks; only nested ones are left.
    if (/\b(min|max|clamp)\([^()]*\(/.test(value)) {
      const lowered = nestedMathFallback(value);
      if (!lowered) return all;
      fallback = lowered;
    } else if (/\b(min|max|clamp)\(/.test(value)) {
      return all;
    }
    if (/\b\d*\.?\d+(dvh|svh|lvh)\b/.test(fallback)) fallback = fallback.replace(/(\d*\.?\d+)(dvh|svh|lvh)\b/g, '$1vh');
    if (/color-mix\(/.test(fallback)) { const flat = colorMixFallback(fallback); if (flat) fallback = flat; }
    const logical = logicalFallback(prop, fallback);
    if (logical) return pre + logical + prop + ':' + value;
    if (fallback === value) return all;
    return pre + prop + ':' + fallback + ';' + prop + ':' + value;
  });
}

/** assets/config.js: build-time config on window[global] + flex-gap behaviour detection (css-compatibility §4). */
export function configScript(global, config) {
  return `// Build-time configuration for the 小红书小工具 container.
window.${global} = ${JSON.stringify(config)};
(function () {
  // Flex gap behaviour detection (Chrome 61 baseline has none): measure a real flex column.
  try {
    var flex = document.createElement('div');
    flex.style.cssText = 'position:absolute;visibility:hidden;display:flex;flex-direction:column;row-gap:1px';
    flex.appendChild(document.createElement('div')); flex.appendChild(document.createElement('div'));
    document.body.appendChild(flex);
    var ok = flex.scrollHeight === 1;
    flex.parentNode.removeChild(flex);
    if (!ok) document.documentElement.className += ' no-flex-gap';
  } catch (e) { document.documentElement.className += ' no-flex-gap'; }
})();
`;
}

/** Static self-check of a dist directory. Returns a list of problem strings (empty = pass). */
export function selfCheck(dist) {
  const problems = [];
  for (const f of walk(dist)) {
    const rel = path.relative(dist, f);
    const ext = path.extname(f).toLowerCase();
    if (path.basename(f).startsWith('.')) problems.push('hidden file: ' + rel);
    if (!ALLOWED_EXT.has(ext)) problems.push('disallowed file type: ' + rel);
    if (['.js', '.css', '.html'].includes(ext)) {
      const t = fs.readFileSync(f, 'utf8');
      for (const [name, re] of FORBIDDEN) if (re.test(t)) problems.push(`${name} in ${rel}`);
      /* A bundler cannot resolve `import(variable)` / `require(variable)`; esbuild lowers it to
         `__require(x)`, which throws in the browser. Upstream usually wraps such probes in a
         try/catch or `.catch(() => null)` as an "optional dependency", so the throw is swallowed
         and the work degrades **silently** to its built-in placeholders — no error, no blank
         screen, and it passes every other check. `__require(` is the only trace left in the
         artifact, so fail the build on it. Fix by making the specifier a literal, or by building
         a static registry module. */
      if (ext === '.js' && /__require\s*\(/.test(t)) {
        problems.push(`unbundled dynamic import in ${rel} — specifier must be a literal, or the work degrades silently at runtime`);
      }
    }
  }
  if (!fs.existsSync(path.join(dist, 'index.html'))) problems.push('index.html missing at dist root');
  return problems;
}

/**
 * opts:
 *   root      game directory (contains src/, dist/ and the zip)
 *   name      zip base name → `${name}-minitool.zip`
 *   minifyIdentifiers  rename locals too (only worth it for multi-MiB bundles)
 *   alias     optional bare-specifier map, e.g. { three: 'lib/three.module.js' } (import-map replacement)
 *   entry     JS entry relative to src/ (ES modules), OR
 *   scripts   ordered list of classic scripts relative to src/ (concatenated, then lowered to ES2017)
 *   css       ordered list of CSS entries relative to src/ (bundled, @import resolved)
 *   cssFix    optional (text) => text applied after bundling (e.g. rewrite font urls)
 *   copy      [[srcRel, distRel], ...] static assets
 *   config    { global, values } written to assets/config.js
 *   html      index.html contents (must load ./assets/config.js then ./assets/app.js as classic scripts)
 */

/* Chrome 61 基线补丁：产物统一前置这一段。
 *
 * 起因：把晚于 Chrome 61 的全局删掉再加载产物，54 个作品里有 15 个**当场启动失败** ——
 * `Object.fromEntries`、`AbortController`、`flatMap`、`roundRect` 是重灾区，
 * 而且多半在模块顶层或启动链上，后果是白屏/永停 loading，不是"某个功能坏了"。
 * 三档 Playwright 跑的是现代 Chromium，永远照不出这一层。
 *
 * 全部按"原生存在就不动"写，只补缺的那几个；不改变现代内核上的行为。 */
/* ---------------------------------------------------------------------------
 * 启动兜底 (assets/boot-guard.js)
 *
 * 市场上反复收到同一条缺陷描述：「小工具功能缺陷，可能是页面按钮无法点击」。
 * 实测复现出来的根因不是输入事件，而是**启动链上抛了未捕获异常**：
 * 这些作品的入口都是一整段顶层代码 —— 建渲染器、编译着色器、读存档、
 * 最后才 addEventListener 把 UI 接上。中间任何一步抛异常，模块就地中止，
 * HTML 早已渲染完毕，于是审核员看到的是「界面完整但一个按钮都点不动」，
 * 而且屏幕上没有任何提示，看起来就是功能缺失。
 *
 * 触发得最多的一步是 new THREE.WebGLRenderer()：审核机没有 GPU / GPU 在黑名单 /
 * 关了硬件加速时，WebGL 上下文创建失败直接抛异常。全量实测 56 个作品里有 21 个
 * 会因此变成死页面。
 *
 * 这里在**所有业务脚本之前**装一道兜底：启动窗口内出现未捕获异常，且页面确实
 * 停摆（rAF 不再出帧）时，把静默死锁换成一条看得懂的提示。
 * 只在「有异常」且「确实没在跑」时才显示，避免误伤正常作品。
 * --------------------------------------------------------------------------- */
/* 入口包跑到最后才会执行到这一行。顶层抛异常时模块就地中止，这行就永远不会跑，
   于是 boot-guard 能"精确"判定启动链断了 —— 不必再靠 rAF 之类的启发式。 */
const APP_DONE_MARK = '\n;try{window.__minitoolAppDone=true}catch(e){}\n';

const bootGuardSource = (needsWebGL) => `(function(){
  var NEEDS_WEBGL = ${needsWebGL ? 'true' : 'false'};
  if (window.__minitoolBootGuard) return;
  window.__minitoolBootGuard = true;

  var BOOT_WINDOW = 20000;   /* 启动窗口：之后的异常算运行期问题，不接管画面 */
  var SETTLE = 1800;         /* 出错后再观察这么久，确认是不是真的停摆 */
  var t0 = Date.now(), shown = false, frames = 0, checking = false;

  /* 活性信号：真正跑起来的作品会持续产出动画帧；启动就挂掉的不会。 */
  var raf = window.requestAnimationFrame;
  if (typeof raf === 'function') {
    window.requestAnimationFrame = function(cb){
      return raf.call(window, function(t){ frames++; return cb(t); });
    };
  }

  var GENERIC = '\\u672c\\u4f5c\\u5728\\u8fd9\\u53f0\\u8bbe\\u5907\\u4e0a\\u6ca1\\u80fd\\u542f\\u52a8\\u5b8c\\u6210\\u3002'
    + '\\u53ef\\u80fd\\u662f\\u6d4f\\u89c8\\u5668\\u5185\\u6838\\u7248\\u672c\\u8fc7\\u4f4e\\uff0c\\u6216\\u56fe\\u5f62\\u80fd\\u529b\\u53d7\\u9650\\u3002';
  var NOGL = '\\u672c\\u4f5c\\u9700\\u8981 WebGL \\u624d\\u80fd\\u8fd0\\u884c\\uff0c\\u5f53\\u524d\\u8bbe\\u5907\\u6ca1\\u6709\\u53ef\\u7528\\u7684 WebGL \\u652f\\u6301\\u3002'
    + '\\u8bf7\\u5728\\u7cfb\\u7edf\\u6216\\u6d4f\\u89c8\\u5668\\u8bbe\\u7f6e\\u91cc\\u5f00\\u542f\\u786c\\u4ef6\\u52a0\\u901f\\uff0c\\u6216\\u6362\\u4e00\\u53f0\\u8bbe\\u5907\\u518d\\u8bd5\\u3002';

  function paint(msg){
    if (shown) return;
    /* 作品自己已经给出更具体的提示时，不要再盖一层 */
    if (document.querySelector('[role="alert"]')) { shown = true; return; }
    shown = true;
    try {
      var box = document.createElement('div');
      box.setAttribute('role','alert');
      box.setAttribute('data-boot-guard','1');
      box.style.cssText = 'position:fixed;left:0;top:0;right:0;bottom:0;z-index:2147483647;'
        + 'display:-webkit-box;display:-webkit-flex;display:flex;-webkit-box-align:center;'
        + '-webkit-align-items:center;align-items:center;-webkit-box-pack:center;'
        + '-webkit-justify-content:center;justify-content:center;'
        + 'padding:28px;margin:0;text-align:center;line-height:1.8;font-size:15px;'
        + 'color:#f2e6d2;background:#161311;'
        + 'font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif';
      box.textContent = msg;
      var host = document.body || document.documentElement;
      if (host) host.appendChild(box);
      else document.addEventListener('DOMContentLoaded', function(){
        (document.body||document.documentElement).appendChild(box);
      });
    } catch (e) {}
  }

  function noWebGL(){
    try {
      var c = document.createElement('canvas');
      return !(c.getContext('webgl2') || c.getContext('webgl') || c.getContext('experimental-webgl'));
    } catch (e) { return true; }
  }

  function onFail(text){
    if (shown || checking) return;
    if (Date.now() - t0 > BOOT_WINDOW) return;   /* 运行期异常不接管画面 */
    /* 直接探一次 WebGL 比匹配异常文案可靠：异常可能来自被它带崩的下一行。 */
    var msg = (noWebGL() || /webgl|graphics context|gpu/i.test(String(text||''))) ? NOGL : GENERIC;
    checking = true;
    var mark = frames;
    setTimeout(function(){
      checking = false;
      /* 入口包跑完了，而且还在出帧 = 作品活着，那条异常无关紧要，别打扰玩家。
         入口没跑完 = 顶层序列中止，UI 永远接不上，无论画面动不动都要提示
         （PixiJS 这类库的 ticker 在渲染器创建失败后仍会继续出帧，只看 rAF 会漏判）。 */
      if (window.__minitoolAppDone && frames - mark > 2) return;
      paint(msg);
    }, SETTLE);
  }

  /* 最常见、而且完全确定的一种失败：作品需要 WebGL，设备没有。
     这里不等异常、不看 rAF —— 需要却没有就是跑不了，直接给一条准确的提示。
     （PixiJS 这类库在渲染器创建失败后 ticker 仍会继续出帧，光靠活性判断会漏掉。） */
  function checkWebGL(){ if (NEEDS_WEBGL && noWebGL()) paint(NOGL); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', checkWebGL);
  else checkWebGL();

  window.addEventListener('error', function(e){
    onFail(e && (e.message || (e.error && e.error.message)));
  });
  window.addEventListener('unhandledrejection', function(e){
    var r = e && e.reason;
    onFail(r && (r.message || r));
  });
})();`

const BASELINE_SHIM = `(function(){
  if (typeof Object.fromEntries !== 'function') Object.fromEntries = function (it) {
    var o = {}, a = Array.isArray(it) ? it : Array.prototype.slice.call(it);
    for (var i = 0; i < a.length; i++) o[a[i][0]] = a[i][1];
    return o;
  };
  if (typeof Object.hasOwn !== 'function') Object.hasOwn = function (o, k) {
    return Object.prototype.hasOwnProperty.call(o, k);
  };
  function def(proto, name, fn) {
    if (typeof proto[name] !== 'function')
      Object.defineProperty(proto, name, { value: fn, writable: true, configurable: true });
  }
  def(Array.prototype, 'flat', function flat(d) {
    d = d === undefined ? 1 : Math.floor(d) || 0;
    var out = [];
    (function walk(a, depth) {
      for (var i = 0; i < a.length; i++) {
        if (Array.isArray(a[i]) && depth > 0) walk(a[i], depth - 1);
        else if (i in a) out.push(a[i]);
      }
    })(this, d);
    return out;
  });
  def(Array.prototype, 'flatMap', function flatMap(fn, thisArg) {
    var out = [];
    for (var i = 0; i < this.length; i++) {
      if (!(i in this)) continue;
      var v = fn.call(thisArg, this[i], i, this);
      if (Array.isArray(v)) out.push.apply(out, v); else out.push(v);
    }
    return out;
  });
  function at(n) {
    n = Math.trunc(n) || 0;
    if (n < 0) n += this.length;
    return (n < 0 || n >= this.length) ? undefined : this[n];
  }
  def(Array.prototype, 'at', at);
  def(String.prototype, 'at', at);
  def(String.prototype, 'replaceAll', function replaceAll(a, b) {
    if (a instanceof RegExp) {
      if (!a.flags || a.flags.indexOf('g') < 0) throw new TypeError('replaceAll must be called with a global RegExp');
      return this.replace(a, b);
    }
    return this.split(a).join(b);
  });
  def(Promise.prototype, 'finally', function (cb) {
    return this.then(
      function (v) { return Promise.resolve(cb()).then(function () { return v; }); },
      function (e) { return Promise.resolve(cb()).then(function () { throw e; }); }
    );
  });
  /* globalThis 是 Chrome 71。第三方大库（PixiJS 等）大量使用，而它们常常用自己的
     <script src> 更早执行 —— 所以垫片必须是页面里的第一个脚本，见下面 assets/baseline.js。 */
  if (typeof window.globalThis === 'undefined') {
    try { Object.defineProperty(window, 'globalThis', { value: window, writable: true, configurable: true }); }
    catch (e) { window.globalThis = window; }
  }
  if (typeof window.queueMicrotask !== 'function')
    window.queueMicrotask = function (fn) { Promise.resolve().then(fn); };
  if (typeof window.structuredClone !== 'function') window.structuredClone = function clone(v, seen) {
    seen = seen || new Map();
    if (v === null || typeof v !== 'object') return v;
    if (seen.has(v)) return seen.get(v);
    if (v instanceof Date) return new Date(v.getTime());
    if (v instanceof RegExp) return new RegExp(v.source, v.flags);
    if (Array.isArray(v)) { var a = []; seen.set(v, a); for (var i = 0; i < v.length; i++) a[i] = clone(v[i], seen); return a; }
    if (v instanceof Map) { var m = new Map(); seen.set(v, m); v.forEach(function (x, k) { m.set(clone(k, seen), clone(x, seen)); }); return m; }
    if (v instanceof Set) { var st = new Set(); seen.set(v, st); v.forEach(function (x) { st.add(clone(x, seen)); }); return st; }
    var o = {}; seen.set(v, o);
    for (var k in v) if (Object.prototype.hasOwnProperty.call(v, k)) o[k] = clone(v[k], seen);
    return o;
  };
  /* AbortController：Three.js 的 DefaultLoadingManager 在模块顶层就 new 它。
     本包不发网络请求，所以只要形状对、signal 能读能挂监听即可。 */
  if (typeof window.AbortController !== 'function') {
    window.AbortSignal = window.AbortSignal || function AbortSignal() {};
    window.AbortController = function AbortController() {
      var listeners = [];
      this.signal = {
        aborted: false, reason: undefined, onabort: null,
        addEventListener: function (t, fn) { if (t === 'abort') listeners.push(fn); },
        removeEventListener: function (t, fn) { var i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); },
        dispatchEvent: function () { return true; }
      };
      var sig = this.signal;
      this.abort = function (reason) {
        if (sig.aborted) return;
        sig.aborted = true; sig.reason = reason;
        if (typeof sig.onabort === 'function') sig.onabort({ type: 'abort', target: sig });
        for (var i = 0; i < listeners.length; i++) listeners[i]({ type: 'abort', target: sig });
      };
    };
  }
  /* ResizeObserver（Chrome 64）：没法真正 polyfill（拿不到非窗口引起的尺寸变化），
     但裸 new 会让整条启动链断掉。退化成"窗口 resize / 方向变化时回调一次"，
     足够让依赖它做布局的代码活下来；真有原生实现时这段不生效。 */
  if (typeof window.ResizeObserver !== 'function') {
    window.ResizeObserver = function ResizeObserver(cb) {
      var targets = [], self = this, timer = 0;
      function fire() {
        clearTimeout(timer);
        timer = setTimeout(function () {
          if (!targets.length) return;
          var entries = targets.map(function (t) {
            var r = t.getBoundingClientRect ? t.getBoundingClientRect() : { width: 0, height: 0 };
            return { target: t, contentRect: r,
                     borderBoxSize: [{ inlineSize: r.width, blockSize: r.height }],
                     contentBoxSize: [{ inlineSize: r.width, blockSize: r.height }] };
          });
          try { cb(entries, self); } catch (e) {}
        }, 60);
      }
      this.observe = function (t) { if (t && targets.indexOf(t) < 0) { targets.push(t); fire(); } };
      this.unobserve = function (t) { var i = targets.indexOf(t); if (i >= 0) targets.splice(i, 1); };
      this.disconnect = function () { targets = []; clearTimeout(timer); };
      window.addEventListener('resize', fire);
      window.addEventListener('orientationchange', fire);
    };
  }
  if (window.CanvasRenderingContext2D) def(CanvasRenderingContext2D.prototype, 'roundRect', function (x, y, w, h, r) {
    var rr = Array.isArray(r) ? r : [r === undefined ? 0 : r];
    var tl = +rr[0] || 0, tr = rr.length > 1 ? +rr[1] || 0 : tl,
        br = rr.length > 2 ? +rr[2] || 0 : tl, bl = rr.length > 3 ? +rr[3] || 0 : tr;
    var m = Math.min(Math.abs(w), Math.abs(h)) / 2;
    tl = Math.min(tl, m); tr = Math.min(tr, m); br = Math.min(br, m); bl = Math.min(bl, m);
    this.moveTo(x + tl, y);
    this.arcTo(x + w, y, x + w, y + h, tr);
    this.arcTo(x + w, y + h, x, y + h, br);
    this.arcTo(x, y + h, x, y, bl);
    this.arcTo(x, y, x + w, y, tl);
    this.closePath();
  });
})();
`;

export async function buildMinitool(opts) {
  await loadEsbuild(opts.root);
  const SRC = opts.srcDir ? path.resolve(opts.srcDir) : path.join(opts.root, 'src');
  const DIST = opts.distDir ? path.resolve(opts.distDir) : path.join(opts.root, 'dist');
  const ZIP = path.join(opts.root, `${opts.name}-minitool.zip`);

  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(path.join(DIST, 'assets'), { recursive: true });

  // 1. JS: one classic ES2017 script — either an ES-module bundle or a concatenation of classic scripts
  if (opts.scripts) {
    const joined = opts.scripts.map((f) => `/* ---- ${f} ---- */\n${fs.readFileSync(path.join(SRC, f), 'utf8')}\n;`).join('\n');
    const js = await esbuild.transform(joined, {
      loader: 'js', target: TARGET, charset: 'utf8', legalComments: 'none',
      minifySyntax: true, minifyWhitespace: true, minifyIdentifiers: false, supported: { 'top-level-await': false },
    });
    for (const w of js.warnings) console.log('esbuild warning:', w.text, w.location ? `(line ${w.location.line}: ${w.location.lineText.trim().slice(0, 100)})` : '');
    fs.writeFileSync(path.join(DIST, 'assets/app.js'), js.code + APP_DONE_MARK);
  } else {
    const js = await esbuild.build({
      entryPoints: [path.join(SRC, opts.entry)],
      bundle: true, format: 'iife', platform: 'browser', target: TARGET,
      // bare specifiers a page served them through an import map (e.g. "three")
      alias: opts.alias ? Object.fromEntries(Object.entries(opts.alias).map(([k, v]) => [k, path.join(SRC, v)])) : undefined,
      outfile: path.join(DIST, 'assets/app.js'),
      // identifiers stay readable by default so a reviewer can follow the shipped code;
      // a very large bundle may opt in to renaming them (see the size note in that game's README)
      minify: false, minifySyntax: true, minifyWhitespace: true, minifyIdentifiers: !!opts.minifyIdentifiers,
      legalComments: 'none', charset: 'utf8', logLevel: 'warning', supported: { 'top-level-await': false },
    });
    if (js.warnings.length) console.log('esbuild js warnings:', js.warnings.length);
    const out = path.join(DIST, 'assets/app.js');
    fs.appendFileSync(out, APP_DONE_MARK);
  }

  // 2. CSS: bundle + lower to Chrome 61, in the order given
  const css = await esbuild.build({
    entryPoints: opts.css.map((c) => path.join(SRC, c)),
    bundle: true, target: TARGET, write: false, outdir: path.join(SRC, '__css__'),
    loader: { '.woff': 'file', '.woff2': 'file', '.ttf': 'file' }, external: ['*.woff', '*.woff2', '*.ttf'], logLevel: 'warning',
  });
  let styleText = '';
  for (const c of opts.css) {
    const base = path.basename(c);
    const f = css.outputFiles.find((o) => o.path.endsWith(base));
    if (!f) throw new Error('css output missing for ' + c);
    styleText += f.text + '\n';
  }
  if (opts.cssFix) styleText = opts.cssFix(styleText);
  styleText = cssSafeArea(cssMathFallbacks(styleText));
  // grid-gap alias for every gap declaration (harmless on flex, needed by Chrome 61 grid)
  styleText = styleText.replace(/(^|[;{])\s*gap\s*:\s*([^;}]+)/g, (all, pre, v) => `${pre}grid-gap:${v};gap:${v}`);
  styleText += '\n/* ---- Chrome 61 baseline: flex-gap fallback (enabled by config.js behaviour detection) ---- */\n' + gapFallbacks(styleText) + '\n';
  styleText = cssLatePropertyFallbacks(styleText);

  /* Chrome 61 上会**静默失效**的写法：页面不报错、探针也扫不出来，只是样式整条丢掉。
     管线补不了的，至少在构建期说出来，别让它们悄悄上线。 */
  {
    const nag = [];
    /* 先算出所有 @supports 块的范围：作者按提醒改成 @supports 分流之后就不该再报警 ——
       修对了还唠叨，只会让人学会无视提醒。下面每条检查都复用这个豁免。 */
    const supportsRanges = [];
    for (const sm of styleText.matchAll(/@supports[^{]*\{/g)) {
      let d = 1, k = sm.index + sm[0].length;
      while (k < styleText.length && d > 0) { if (styleText[k] === '{') d++; else if (styleText[k] === '}') d--; k++; }
      supportsRanges.push([sm.index, k]);
    }
    const inSupports = (i) => supportsRanges.some(([a, b]) => i >= a && i < b);

    // 1) 自定义属性里放 math：--x: max(...) 本身能存下，但 var(--x) 代入消费方时整条声明失效。
    //    已经按建议用 @supports 分流的**不再唠叨** —— 修对了还报警只会让人学会无视提醒。
    for (const m of styleText.matchAll(/(--[\w-]+)\s*:\s*([^;{}]*\b(?:min|max|clamp)\([^;{}]*)/g)) {
      if (inSupports(m.index)) continue;
      nag.push(`自定义属性 ${m[1]} 的值含 min/max/clamp —— Chrome 61 上引用它的声明会整条失效，请改用 @supports 升级写法`);
    }
    // 2) aspect-ratio：管线不处理（Chrome 88+），塌成内容高度
    for (const m of styleText.matchAll(/(?:^|[;{\s])aspect-ratio\s*:/g)) {
      if (inSupports(m.index)) continue;          // 已用 @supports 分流的不再唠叨
      nag.push('用到 aspect-ratio（Chrome 88+），管线不降级 —— 老内核上会塌成内容高度，请自己兜一个固定高');
      break;
    }
    // 3) 其它在 Chrome 61 上整条/整规则失效、探针又扫不出来的写法
    for (const m of styleText.matchAll(/overflow-wrap\s*:\s*anywhere/g)) {
      if (inSupports(m.index)) continue;
      nag.push('用到 overflow-wrap:anywhere（Chrome 80+）—— 老内核整条丢掉，长词会顶破容器，改用 word-wrap:break-word（**不要用 word-break:break-all**，它会把英文单词从中间劈开，boards→boar/ds）');
      break;
    }
    for (const m of styleText.matchAll(/:focus-visible/g)) {
      if (inSupports(m.index)) continue;
      nag.push('用到 :focus-visible（Chrome 86+）—— 老内核**整条规则**失效（不只是这一个声明），焦点样式会消失，需另给 :focus 兜底');
      break;
    }
    // 4) flex-wrap + gap：回退层的 `> * + *` 双向 margin 会把同一行后继元素逐格下推成阶梯。
    //    注意按**选择器聚合**再判断 —— display:flex+gap 和 flex-wrap:wrap 常常分散在两条规则里。
    const bySel = new Map();
    for (const m of styleText.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const sel = m[1].trim();
      if (sel.startsWith('@') || sel.includes('no-flex-gap') || inSupports(m.index)) continue;
      const cur = bySel.get(sel) || { flex: false, gap: false, wrap: false };
      if (/display\s*:\s*(inline-)?flex/.test(m[2])) cur.flex = true;
      if (/(?:^|;)\s*gap\s*:/.test(m[2])) cur.gap = true;
      if (/flex-wrap\s*:\s*wrap/.test(m[2])) cur.wrap = true;
      bySel.set(sel, cur);
    }
    for (const [sel, v] of bySel)
      if (v.flex && v.gap && v.wrap)
        nag.push(`选择器 ${sel.slice(0, 48)} 同时用了 flex-wrap:wrap 和 gap —— no-flex-gap 回退会排成阶梯，建议改 grid`);
    const uniq = [...new Set(nag)];
    if (uniq.length) {
      console.log('CSS 基线提醒（不阻断构建，但请逐条确认）:');
      for (const n of uniq.slice(0, 12)) console.log('  - ' + n);
      if (uniq.length > 12) console.log(`  … 另有 ${uniq.length - 12} 条`);
    }
  }
  fs.writeFileSync(path.join(DIST, 'assets/style.css'), styleText);

  // 3. config.js (classic script, runs before app.js)
  /* 垫片单独成文件并作为页面**第一个**脚本注入：拼在 app.js 前面是不够的 ——
     用 copy 带过去的第三方库有自己的 <script src>，执行更早，它们里面的 globalThis
     之类在老内核上会先一步 ReferenceError，页面全白。 */
  fs.writeFileSync(path.join(DIST, 'assets/baseline.js'), BASELINE_SHIM);
  /* 作品到底需不需要 WebGL，构建期一眼就能看出来（产物 + copy 进来的第三方库）。
     把结论烧进兜底脚本，运行期就不必猜了。 */
  const needsWebGL = (() => {
    const RE = /WebGLRenderer|WebGL2RenderingContext|getContext\s*\(\s*['"`](?:webgl2?|experimental-webgl)|pixi|THREE\.|babylon/i;
    const files = [path.join(DIST, 'assets/app.js')];
    for (const [, to] of opts.copy) { if (/\.js$/i.test(to)) files.push(path.join(DIST, to)); }
    for (const f of files) {
      try { if (RE.test(fs.readFileSync(f, 'utf8'))) return true; } catch (e) { /* 读不到就当不需要 */ }
    }
    return false;
  })();
  fs.writeFileSync(path.join(DIST, 'assets/boot-guard.js'), bootGuardSource(needsWebGL));
  if (needsWebGL) console.log('boot-guard: 已标记本作需要 WebGL，缺 WebGL 时会给出明确提示');
  fs.writeFileSync(path.join(DIST, 'assets/config.js'), configScript(opts.config.global, opts.config.values));

  // 4. static assets
  for (const [from, to] of opts.copy) {
    const dst = path.join(DIST, to);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.join(SRC, from), dst);
  }

  // 5. index.html（附第三方许可）
  /* 容器只收 html/css/js/图片/字体/json —— `.txt` 进不了包，于是 vendor 的 LICENSE 文件
     全被静默丢掉了。但 Three.js 这类 MIT 依赖要求"在软件的所有副本中附带版权与许可声明"。
     esbuild 配了 legalComments:'none' 会剥掉 JS 注释，所以改把许可原文写进 index.html 的
     HTML 注释：`.html` 是允许的扩展名，注释不影响渲染，审计也不会拦。 */
  let indexHtml = opts.html;
  {
    const tag = '<script src="./assets/baseline.js"></script>\n'
      + '<script src="./assets/boot-guard.js"></script>';
    const firstScript = indexHtml.search(/<script\b/i);
    if (firstScript >= 0) indexHtml = indexHtml.slice(0, firstScript) + tag + '\n' + indexHtml.slice(firstScript);
    else if (/<\/head>/i.test(indexHtml)) indexHtml = indexHtml.replace(/<\/head>/i, tag + '\n</head>');
    else throw new Error('index.html 里既没有 <script> 也没有 </head>，无法注入基线垫片');
  }
  const licFiles = [];
  (function findLicenses(dir, depth) {
    if (depth > 2 || !fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') findLicenses(full, depth + 1); continue; }
      if (/^(licen[sc]e|.*-licen[sc]e|licen[sc]e-.*)(\.(txt|md))?$/i.test(e.name)) licFiles.push(full);
    }
  })(SRC, 0);
  if (licFiles.length) {
    const blocks = licFiles.map((f) => {
      const rel = path.relative(SRC, f);
      // HTML 注释里不能出现 `--`，否则会提前闭合注释
      const body = fs.readFileSync(f, 'utf8').trim().replace(/--+/g, (m) => '\u2013'.repeat(m.length));
      return `${rel}\n${'='.repeat(rel.length)}\n${body}`;
    });
    indexHtml = indexHtml.replace(/<\/body>/i,
      `</body>\n<!-- 第三方许可 / THIRD-PARTY LICENSES\n\n${blocks.join('\n\n')}\n-->`);
    console.log(`third-party licenses inlined into index.html: ${licFiles.map((f) => path.relative(SRC, f)).join(', ')}`);
  }
  fs.writeFileSync(path.join(DIST, 'index.html'), indexHtml);

  // 6. static self-check
  const problems = selfCheck(DIST);
  const files = walk(DIST);
  const textTotal = files.filter((f) => ['.js', '.css', '.html', '.json'].includes(path.extname(f))).reduce((s, f) => s + sizeOf(f), 0);
  console.log('dist files:\n  ' + files.map((f) => path.relative(DIST, f) + ' ' + (sizeOf(f) / 1024).toFixed(1) + 'K').join('\n  '));
  console.log('text total: ' + (textTotal / 1048576).toFixed(2) + ' MiB');
  if (problems.length) { console.log('PROBLEMS:\n - ' + problems.join('\n - ')); process.exit(1); }

  // 7. zip from inside dist (index.html at the zip root)
  fs.rmSync(ZIP, { force: true });
  /* 用 scripts/zip.mjs 在进程内打包，不再调外部 `zip`：Windows 上没有这个命令，
     而容器要求条目名一律用正斜杠、且不能夹带 __MACOSX / 点文件。 */
  fs.writeFileSync(ZIP, createZip(
    files
      .map((f) => path.relative(DIST, f).split(path.sep).join('/'))
      .filter((rel) => !rel.split('/').some((seg) => seg.startsWith('.') || seg === 'Thumbs.db'))
      .sort()
      .map((rel) => ({ name: rel, data: fs.readFileSync(path.join(DIST, rel)) }))
  ));
  console.log('zip: ' + ZIP + ' ' + (sizeOf(ZIP) / 1048576).toFixed(2) + ' MiB');
  return { dist: DIST, zip: ZIP };
}
