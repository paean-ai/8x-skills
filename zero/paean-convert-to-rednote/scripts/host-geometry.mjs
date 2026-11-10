// Local host mock, not a platform contract. Rectangles are physical CSS pixels.
export function hostZones({width, height, safe = [0, 0, 0, 0], edge = 'auto'} = {}) {
  if (![width, height].every(n => Number.isFinite(n) && n > 0)) throw Error('Invalid viewport')
  if (safe.length !== 4 || !safe.every(n => Number.isFinite(n) && n >= 0)) throw Error('safe-area requires top,right,bottom,left')
  const [top, right, bottom, left] = safe
  if (left + right >= width || top + bottom >= height) throw Error('Safe area consumes viewport')
  if (!['auto', 'top', 'left'].includes(edge)) throw Error('host-edge must be auto, top or left')
  if (edge === 'auto') edge = width > height ? 'left' : 'top'
  const zones = []
  const add = (name, x, y, w, h) => { if (w > 0 && h > 0) zones.push({name, x, y, w, h}) }
  add('system-top', 0, 0, width, top)
  add('system-right', width - right, 0, right, height)
  add('system-bottom', 0, height - bottom, width, bottom)
  add('system-left', 0, 0, left, height)
  if (edge === 'top') {
    add('host-back', left, top + 10, 47, 32)
    add('host-capsule', width - right - 93, top + 10, 93, 32)
  } else {
    add('host-back', left, top + 10, 42, 32)
    add('host-capsule', left, height - bottom - 93, 42, 93)
  }
  return zones
}

export function validateZones(zones) {
  if (!Array.isArray(zones) || !zones.length || zones.some(r =>
    !r || !['x', 'y', 'w', 'h'].every(k => Number.isFinite(r[k])) || r.w <= 0 || r.h <= 0)) {
    throw Error('zones must be a nonempty array of {name?, x, y, w, h} physical rectangles')
  }
  return zones.map((r, i) => ({...r, name: String(r.name || `host-${i + 1}`)}))
}

export function intersects(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}
