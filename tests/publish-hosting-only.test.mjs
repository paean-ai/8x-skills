import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const repoRoot = path.resolve(import.meta.dirname, '..')
const script = path.join(repoRoot, 'codex/paean-publish/scripts/publish.mjs')

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'paean-publish-test-'))
  await mkdir(path.join(root, 'dist'), { recursive: true })
  await writeFile(path.join(root, 'dist/index.html'), '<!doctype html><title>Fixture</title>')
  await writeFile(path.join(root, 'dist/app.js'), 'console.log("fixture")')
  return root
}

async function runPublish(cwd, args, env = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd,
      env: { ...process.env, ...env },
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
    const request = { method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks) }
    requests.push(request)
    await handler(request, res)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  }
}

test('hosting-only dry-run selects dist and explicitly excludes Apps Square', async () => {
  const root = await fixture()
  try {
    const result = await runPublish(root, ['--dry-run', '--hosting-only', '--dir', 'dist', '--handle', 'paeaninsight'])
    assert.equal(result.code, 0, result.stderr)
    const output = JSON.parse(result.stdout)
    assert.equal(output.mode, 'hosting-only')
    assert.equal(output.destination, 'Clide hosting only (*.clide.app; no Apps Square listing)')
    assert.equal(output.requestedHandle, 'paeaninsight')
    assert.equal(output.runtimeCompatibility.status, 'static-compatible')
    assert.equal(output.secretScan.status, 'passed')
    assert.equal(output.writesLocalState, false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('hosting-only real publish calls only /publish/clide and saves its handle', async () => {
  const root = await fixture()
  const api = await mockApi((request, res) => {
    assert.equal(request.url, '/publish/clide')
    assert.equal(request.method, 'POST')
    assert.equal(request.headers.authorization, 'Bearer test-token')
    const body = request.body.toString('latin1')
    assert.match(body, /name="handle"[\s\S]*paeaninsight/)
    assert.match(body, /name="archive"; filename="site.zip"/)
    res.writeHead(201, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ success: true, data: {
      handle: 'paeaninsight',
      url: 'https://paeaninsight.clide.app/',
      archiveUrl: 'https://paeaninsight.clide.app/__clide_project.zip',
      fileCount: 2,
      totalBytes: 64,
    } }))
  })
  try {
    const result = await runPublish(root, ['--hosting-only', '--yes', '--dir', 'dist', '--handle', 'paeaninsight'], {
      PAEAN_API_BASE: api.baseUrl,
      PAEAN_AUTH_TOKEN: 'test-token',
    })
    assert.equal(result.code, 0, result.stderr)
    assert.equal(api.requests.length, 1)
    assert.match(result.stdout, /"listedInSquare": false/)
    const state = JSON.parse(await readFile(path.join(root, '.clide/publish.json'), 'utf8'))
    assert.equal(state.mode, 'hosting-only')
    assert.equal(state.handle, 'paeaninsight')
    assert.equal(state.squareAppHashKey, undefined)
    await assert.rejects(readFile(path.join(root, 'clide.json'), 'utf8'))
    await assert.rejects(readFile(path.join(root, 'LICENSE'), 'utf8'))
  } finally {
    await api.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('hosting-only re-publish reuses the saved handle', async () => {
  const root = await fixture()
  await mkdir(path.join(root, '.clide'), { recursive: true })
  await writeFile(path.join(root, '.clide/publish.json'), JSON.stringify({ mode: 'hosting-only', handle: 'savedhandle' }))
  const api = await mockApi((request, res) => {
    assert.match(request.body.toString('latin1'), /name="handle"[\s\S]*savedhandle/)
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ success: true, data: {
      handle: 'savedhandle', url: 'https://savedhandle.clide.app/', fileCount: 2, totalBytes: 64,
    } }))
  })
  try {
    const result = await runPublish(root, ['--hosting-only', '--yes', '--dir', 'dist'], {
      PAEAN_API_BASE: api.baseUrl,
      PAEAN_AUTH_TOKEN: 'test-token',
    })
    assert.equal(result.code, 0, result.stderr)
    assert.equal(api.requests.length, 1)
  } finally {
    await api.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('Worker and D1 projects are reported in dry-run and blocked before upload', async () => {
  const root = await fixture()
  await writeFile(path.join(root, 'wrangler.jsonc'), '{ "main": "worker/index.ts", "d1_databases": [{ "binding": "DB" }] }')
  try {
    const dryRun = await runPublish(root, ['--dry-run', '--hosting-only', '--dir', 'dist'])
    assert.equal(dryRun.code, 0, dryRun.stderr)
    const report = JSON.parse(dryRun.stdout)
    assert.equal(report.runtimeCompatibility.status, 'blocked')
    assert.deepEqual(report.runtimeCompatibility.detected.features, ['Worker entrypoint', 'D1 binding'])

    const real = await runPublish(root, ['--hosting-only', '--yes', '--dir', 'dist'], {
      PAEAN_AUTH_TOKEN: 'test-token',
      PAEAN_API_BASE: 'http://127.0.0.1:1',
    })
    assert.equal(real.code, 1)
    assert.match(real.stderr, /Publish blocked/)
    assert.match(real.stderr, /does not deploy Worker code or provision D1\/R2/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('default mode remains the workspace and Apps Square pipeline', async () => {
  const root = await fixture()
  const api = await mockApi((request, res) => {
    res.setHeader('content-type', 'application/json')
    if (request.url === '/v2/workspace') {
      res.end(JSON.stringify({ success: true, workspace: { hashKey: 'workspace-1' } }))
      return
    }
    if (request.url === '/v2/workspace/workspace-1/files/zip') {
      res.end(JSON.stringify({ success: true, fileCount: 2, totalBytes: 64 }))
      return
    }
    if (request.url === '/square/publish') {
      const body = JSON.parse(request.body.toString('utf8'))
      assert.equal(body.visibility, 'public')
      assert.equal(body.workspaceHashKey, 'workspace-1')
      res.end(JSON.stringify({ success: true, data: {
        hashKey: 'square-1',
        playUrl: 'https://assigned123.clide.app/',
        publishedSiteHandle: 'assigned123',
        status: 'listed',
      } }))
      return
    }
    res.writeHead(404)
    res.end(JSON.stringify({ success: false, error: 'unexpected path' }))
  })
  try {
    const result = await runPublish(root, ['--yes', '--dir', 'dist', '--title', 'Fixture App'], {
      PAEAN_API_BASE: api.baseUrl,
      PAEAN_AUTH_TOKEN: 'test-token',
    })
    assert.equal(result.code, 0, result.stderr)
    assert.deepEqual(api.requests.map(request => request.url), [
      '/v2/workspace',
      '/v2/workspace/workspace-1/files/zip',
      '/square/publish',
    ])
    const state = JSON.parse(await readFile(path.join(root, '.clide/publish.json'), 'utf8'))
    assert.equal(state.mode, 'square')
    assert.equal(state.squareAppHashKey, 'square-1')
    assert.equal(state.handle, 'assigned123')
  } finally {
    await api.close()
    await rm(root, { recursive: true, force: true })
  }
})
