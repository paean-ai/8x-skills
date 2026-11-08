#!/usr/bin/env node
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export function initWeapp({ directory, appid = 'touristappid', orientation = 'portrait', namespace, title = 'WeChat port probe' }) {
  if (!directory) throw new Error('Provide --dir')
  if (!namespace || !/^[a-z0-9._-]+$/i.test(namespace)) throw new Error('Provide --namespace using letters, numbers, dot, dash or underscore')
  if (!['portrait', 'landscape'].includes(orientation)) throw new Error('Orientation must be portrait or landscape')
  if (appid !== 'touristappid' && !/^wx[a-f0-9]{16}$/i.test(appid)) throw new Error('Invalid AppID format')
  const target = path.resolve(directory)
  if (existsSync(target)) throw new Error('Output directory already exists; choose a new directory')
  const runtime = readFileSync(new URL('./templates/wx-runtime.js', import.meta.url), 'utf8')
  mkdirSync(target, { recursive: true })
  writeFileSync(path.join(target, 'wx-runtime.js'), runtime)
  writeFileSync(path.join(target, 'game.json'), JSON.stringify({ deviceOrientation: orientation }, null, 2) + '\n')
  writeFileSync(path.join(target, 'project.config.json'), JSON.stringify({ appid, projectname: title, compileType: 'game', miniprogramRoot: './',
    setting: { urlCheck: true, es6: true, minified: true } }, null, 2) + '\n')
  writeFileSync(path.join(target, 'game.js'), `// Diagnostic starter only. Replace this entry with the reviewed game port.\nconst createRuntime = require('./wx-runtime.js')\nconst app = createRuntime(wx, { namespace: ${JSON.stringify(namespace)} })\nconst ctx = app.canvas.getContext('2d')\nlet point = null\napp.onTouch(p => { point = p.type === 'end' || p.type === 'cancel' ? null : p })\napp.start((dt, v) => {\n  ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0)\n  ctx.fillStyle = '#ecf8f1'; ctx.fillRect(0, 0, v.width, v.height)\n  ctx.fillStyle = '#153f34'; ctx.font = '18px sans-serif'\n  ctx.fillText('WeChat runtime probe', 24, v.height / 2 - 24)\n  ctx.font = '13px sans-serif'\n  ctx.fillText('Touch / cancel / background / resize', 24, v.height / 2)\n  if (point) { ctx.beginPath(); ctx.arc(point.x, point.y, 20, 0, Math.PI * 2); ctx.fill() }\n})\n`)
  return { directory: target, files: ['game.js', 'game.json', 'project.config.json', 'wx-runtime.js'],
    status: 'diagnostic-starter-not-a-converted-game', appid, requiresOwnAppIdForDeviceValidation: appid === 'touristappid' }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2), options = {}, keys = { '--dir': 'directory', '--appid': 'appid', '--orientation': 'orientation', '--namespace': 'namespace', '--title': 'title' }
    if (args.length === 1 && args[0] === '--help') console.log('Usage: node init-weapp.mjs --dir NEW_DIRECTORY --namespace NEW_SAVE_NAMESPACE [--appid wx...] [--orientation portrait|landscape] [--title NAME]')
    else {
      for (let i = 0; i < args.length; i += 2) {
        const key = keys[args[i]]
        if (!key || !args[i + 1] || args[i + 1].startsWith('--') || key in options) throw new Error('Unknown, duplicate or incomplete argument: ' + args[i])
        options[key] = args[i + 1]
      }
      console.log(JSON.stringify(initWeapp(options), null, 2))
    }
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
