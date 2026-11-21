import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const repoRoot = path.resolve(import.meta.dirname, '..')
const wishesScript = path.join(repoRoot, 'codex/paean-wishes/scripts/wishes.mjs')
const publishScript = path.join(repoRoot, 'codex/paean-publish/scripts/publish.mjs')

async function runNode(script, cwd, args, env = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd,
      env: { ...process.env, PAEAN_SESSION_JSONL: '', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.on('error', reject)
    child.on('close', code => resolve({ code, stdout, stderr }))
  })
}

async function mockApi(handler) {
  const requests = []
  const server = http.createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const entry = {
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: Buffer.concat(chunks).toString('utf8'),
    }
    requests.push(entry)
    await handler(entry, res)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve())),
  }
}

async function projectFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'paean-wish-test-'))
  await mkdir(path.join(root, 'dist'), { recursive: true })
  await writeFile(path.join(root, 'dist/index.html'), '<!doctype html><title>Wish Fulfillment</title>')
  await writeFile(path.join(root, 'clide.json'), JSON.stringify({
    schemaVersion: 1,
    title: 'Neon Pinball',
    summary: 'Arcade cyber pinball game built for a community wish.',
    category: 'game',
    tags: ['arcade', 'pinball'],
  }, null, 2))
  return root
}

test('wishes list and get work without auth tokens against the public wish API', async () => {
  const api = await mockApi(async (req, res) => {
    res.setHeader('Content-Type', 'application/json')
    if (req.url.startsWith('/square/wishes?')) {
      res.end(JSON.stringify({
        success: true,
        items: [{ hashKey: 'wsh001', title: 'Neon Pinball', prompt: 'Build cyber pinball', category: 'game', status: 'open', fulfillmentCount: 2 }],
        total: 1,
        page: 1,
        limit: 20,
      }))
      return
    }
    if (req.url === '/square/wishes/wsh001') {
      res.end(JSON.stringify({
        success: true,
        data: {
          hashKey: 'wsh001',
          title: 'Neon Pinball',
          prompt: 'Build cyber pinball with multiball',
          category: 'game',
          tags: ['pinball'],
          referenceImages: ['https://storage.googleapis.com/x/ref.png'],
          status: 'open',
          fulfillmentCount: 0,
          authorName: 'Dreamer',
          createdAt: '2026-11-21T00:00:00Z',
          fulfillments: [],
        },
      }))
      return
    }
    res.statusCode = 404
    res.end(JSON.stringify({ success: false, error: 'not found' }))
  })
  const cwd = await projectFixture()
  const emptyHome = await mkdtemp(path.join(os.tmpdir(), 'paean-noauth-'))
  try {
    const listRes = await runNode(wishesScript, cwd, ['list', '--q', 'pinball', '--fulfillment', 'unfulfilled', '--json'], {
      PAEAN_API_BASE: api.baseUrl,
      HOME: emptyHome,
      ZERO_CONFIG_DIR: '',
      PAEAN_AUTH_TOKEN: '',
      PAEAN_CREDENTIALS_FILE: '',
    })
    assert.equal(listRes.code, 0, listRes.stderr)
    const listJson = JSON.parse(listRes.stdout)
    assert.equal(listJson.total, 1)
    assert.equal(api.requests[0].headers.authorization, undefined)

    const getRes = await runNode(wishesScript, cwd, ['get', 'https://www.paean.ai/wishes/wsh001', '--json'], {
      PAEAN_API_BASE: api.baseUrl,
      HOME: emptyHome,
      ZERO_CONFIG_DIR: '',
      PAEAN_AUTH_TOKEN: '',
      PAEAN_CREDENTIALS_FILE: '',
    })
    assert.equal(getRes.code, 0, getRes.stderr)
    const getJson = JSON.parse(getRes.stdout)
    assert.equal(getJson.data.hashKey, 'wsh001')
  } finally {
    await api.close()
    await rm(cwd, { recursive: true, force: true })
    await rm(emptyHome, { recursive: true, force: true })
  }
})

test('wishes create supports dry-run credit disclosure and authenticated POST /square/wishes', async () => {
  const api = await mockApi(async (req, res) => {
    res.setHeader('Content-Type', 'application/json')
    if (req.method === 'POST' && req.url === '/square/wishes') {
      const payload = JSON.parse(req.body)
      res.statusCode = 201
      res.end(JSON.stringify({
        success: true,
        creditsCharged: 10,
        remainingCredits: 90,
        alreadyCreated: false,
        data: { hashKey: 'wsh_new123', title: payload.title || 'Derived', prompt: payload.prompt },
      }))
      return
    }
    res.statusCode = 404
    res.end(JSON.stringify({ success: false }))
  })
  const cwd = await projectFixture()
  try {
    const dryRes = await runNode(wishesScript, cwd, [
      'create',
      '--title', 'Voxel Train',
      '--prompt', 'Build a cozy voxel diorama train table with day-night cycle',
      '--category', 'game',
      '--tags', 'voxel,train',
      '--dry-run',
    ], { PAEAN_API_BASE: api.baseUrl })
    assert.equal(dryRes.code, 0, dryRes.stderr)
    const dryJson = JSON.parse(dryRes.stdout)
    assert.equal(dryJson.creditsCost, 10)
    assert.equal(api.requests.length, 0)

    const realRes = await runNode(wishesScript, cwd, [
      'create',
      '--title', 'Voxel Train',
      '--prompt', 'Build a cozy voxel diorama train table with day-night cycle',
      '--category', 'game',
      '--tags', 'voxel,train',
    ], { PAEAN_API_BASE: api.baseUrl, PAEAN_AUTH_TOKEN: 'jwt-test' })
    assert.equal(realRes.code, 0, realRes.stderr)
    const realJson = JSON.parse(realRes.stdout)
    assert.equal(realJson.creditsCharged, 10)
    assert.equal(realJson.data.hashKey, 'wsh_new123')
    assert.equal(api.requests[0].headers.authorization, 'Bearer jwt-test')
  } finally {
    await api.close()
    await rm(cwd, { recursive: true, force: true })
  }
})

test('wishes prepare scaffolds WISH.md + clide.json.wish and publish forwards wishHashKey/--no-wish', async () => {
  let squarePublishBody = null
  const api = await mockApi(async (req, res) => {
    res.setHeader('Content-Type', 'application/json')
    if (req.method === 'GET' && req.url === '/square/wishes/wsh_prep99') {
      res.end(JSON.stringify({
        success: true,
        data: {
          hashKey: 'wsh_prep99',
          title: 'Pixel Pinball',
          prompt: 'Make a fast 2D pixel pinball game',
          category: 'game',
          tags: ['pinball', 'pixel'],
          referenceImages: [],
          status: 'open',
          fulfillmentCount: 0,
          authorName: 'Tester',
          createdAt: '2026-11-21T00:00:00Z',
          fulfillments: [],
        },
      }))
      return
    }
    if (req.method === 'POST' && req.url === '/v2/workspace') {
      res.end(JSON.stringify({ workspace: { hashKey: 'ws_wish_1' } }))
      return
    }
    if (req.method === 'POST' && req.url === '/v2/workspace/ws_wish_1/files/zip') {
      res.end(JSON.stringify({ fileCount: 1, totalBytes: 42 }))
      return
    }
    if (req.method === 'POST' && req.url === '/square/publish') {
      squarePublishBody = JSON.parse(req.body)
      res.end(JSON.stringify({
        success: true,
        data: {
          hashKey: 'app_wish_1',
          playUrl: 'https://neon.clide.app/',
          publishedSiteHandle: 'neon',
          status: 'listed',
          wish: squarePublishBody.wishHashKey
            ? { hashKey: squarePublishBody.wishHashKey, title: 'Pixel Pinball', status: 'open', fulfillmentCount: 1, note: squarePublishBody.wishNote || null }
            : null,
        },
      }))
      return
    }
    res.statusCode = 404
    res.end(JSON.stringify({ success: false }))
  })
  const cwd = await projectFixture()
  try {
    const prep = await runNode(wishesScript, cwd, ['prepare', 'https://www.8x.gg/wishes/wsh_prep99', '--note', 'Includes multiball mode'], {
      PAEAN_API_BASE: api.baseUrl,
    })
    assert.equal(prep.code, 0, prep.stderr)
    const wishMd = await readFile(path.join(cwd, 'WISH.md'), 'utf8')
    assert.match(wishMd, /Make a fast 2D pixel pinball game/)
    const clideJson = JSON.parse(await readFile(path.join(cwd, 'clide.json'), 'utf8'))
    assert.equal(clideJson.wish.hashKey, 'wsh_prep99')
    assert.equal(clideJson.wish.note, 'Includes multiball mode')

    // Reject --wish combined with --hosting-only
    const badCombo = await runNode(publishScript, cwd, ['--dry-run', '--hosting-only', '--wish', 'wsh_prep99'])
    assert.notEqual(badCombo.code, 0)
    assert.match(badCombo.stderr, /--hosting-only/)

    // Real Square publish picks up clide.json.wish automatically
    const pub = await runNode(publishScript, cwd, ['--yes', '--no-session'], {
      PAEAN_API_BASE: api.baseUrl,
      PAEAN_AUTH_TOKEN: 'jwt-test',
    })
    assert.equal(pub.code, 0, pub.stderr)
    assert.equal(squarePublishBody.wishHashKey, 'wsh_prep99')
    assert.equal(squarePublishBody.wishNote, 'Includes multiball mode')

    // --no-wish sends wishHashKey: null and clears clide.json.wish
    const detach = await runNode(publishScript, cwd, ['--yes', '--no-session', '--no-wish'], {
      PAEAN_API_BASE: api.baseUrl,
      PAEAN_AUTH_TOKEN: 'jwt-test',
    })
    assert.equal(detach.code, 0, detach.stderr)
    assert.equal(squarePublishBody.wishHashKey, null)
    const updatedManifest = JSON.parse(await readFile(path.join(cwd, 'clide.json'), 'utf8'))
    assert.equal(updatedManifest.wish, undefined)
  } finally {
    await api.close()
    await rm(cwd, { recursive: true, force: true })
  }
})
