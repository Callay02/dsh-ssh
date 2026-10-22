import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import { gunzipSync } from 'node:zlib'
import { SshManager } from '../host/manager.js'
import { registerRoutes } from '../host/routes.js'

const TEST_USER = process.env.USER || os.userInfo().username
const dataDir = '/tmp/dsh-ssh-test/routes-data'
await fsp.rm(dataDir, { recursive: true, force: true })
const manager = new SshManager({ dataDir, connectTimeoutMs: 8000 })
const routes = new Map()
const ctx = {
  get(name) {
    if (name !== 'connection') return undefined
    return {
      fetch: {
        register(route) {
          routes.set(route.path, route)
          return () => routes.delete(route.path)
        },
      },
    }
  },
}
registerRoutes(ctx, manager)
assert.deepEqual([...routes.keys()].sort(), [
  '/api/ssh', '/api/ssh/archive', '/api/ssh/download', '/api/ssh/files', '/api/ssh/metrics', '/api/ssh/terminal', '/api/ssh/upload',
])

async function call(path, init) {
  const route = routes.get(path.split('?')[0])
  assert.ok(route, `route ${path}`)
  const response = await route.fetch(new Request(`http://127.0.0.1:60002${path}`, init))
  return response
}
async function json(response) {
  return await response.json()
}

let profile
try {
  let response = await call('/api/ssh?op=list')
  let body = await json(response)
  assert.equal(body.ok, true)
  assert.equal(body.connections.length, 0)

  response = await call('/api/ssh', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ op: 'save', connection: {
      name: 'route-test', host: '127.0.0.1', port: 2222, username: TEST_USER, auth: 'key',
      privateKeyPath: '/tmp/dsh-ssh-test/client_ed25519',
    } }),
  })
  body = await json(response)
  assert.equal(body.ok, true)
  profile = body.connection
  assert.equal(profile.status, 'disconnected')

  response = await call('/api/ssh', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ op: 'connect', id: profile.id }),
  })
  body = await json(response)
  assert.equal(body.ok, true)
  assert.equal(body.connection.status, 'connected')

  response = await call('/api/ssh', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ op: 'terminal.open', id: profile.id, cols: 90, rows: 24 }),
  })
  body = await json(response)
  assert.equal(body.ok, true)
  const terminalId = body.terminal.id

  response = await call(`/api/ssh/terminal?op=poll&terminal=${terminalId}&cursor=0&wait=3000`)
  body = await json(response)
  assert.equal(body.ok, true)
  assert.ok(body.endOffset >= 0)

  response = await call('/api/ssh', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ op: 'terminal.input', terminalId, data: "printf 'ROUTE_OK\\n'\n" }),
  })
  assert.equal((await json(response)).ok, true)

  let cursor = body.cursor
  let text = ''
  const deadline = Date.now() + 6000
  while (Date.now() < deadline && !text.includes('ROUTE_OK')) {
    response = await call(`/api/ssh/terminal?op=poll&terminal=${terminalId}&cursor=${cursor}&wait=500`)
    body = await json(response)
    cursor = body.cursor
    text += body.data
  }
  assert.ok(text.includes('ROUTE_OK'), `terminal output: ${JSON.stringify(text.slice(-200))}`)

  await call('/api/ssh', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ op: 'terminal.close', terminalId }),
  })

  response = await call(`/api/ssh/metrics?connection=${profile.id}`)
  body = await json(response)
  assert.equal(body.ok, true)
  assert.equal(body.metrics.connected, true)
  assert.ok(['darwin', 'linux'].includes(body.metrics.platform), `unexpected platform: ${body.metrics.platform}`)
  assert.ok(body.metrics.memory.percent > 0)
  await new Promise((resolve) => setTimeout(resolve, 1500))
  response = await call(`/api/ssh/metrics?connection=${profile.id}`)
  body = await json(response)
  assert.equal(body.ok, true)
  assert.equal(body.metrics.connected, true)
  assert.ok(body.metrics.network.rxRate >= 0)

  await manager.exec(profile.id, "rm -rf '/tmp/dsh archive test' && mkdir -p '/tmp/dsh archive test/sub' && printf hello > '/tmp/dsh archive test/sub/a.txt'", { timeoutMs: 8000 })
  response = await call(`/api/ssh/archive?connection=${profile.id}&path=${encodeURIComponent('/tmp/dsh archive test')}`)
  assert.equal(response.status, 200)
  const archive = Buffer.from(await response.arrayBuffer())
  assert.equal(archive[0], 0x1f)
  assert.equal(archive[1], 0x8b)
  const tar = gunzipSync(archive)
  assert.ok(tar.includes(Buffer.from('sub/a.txt')))
  assert.ok(tar.includes(Buffer.from('hello')))
  assert.ok((response.headers.get('content-disposition') ?? '').includes('dsh archive test.tar.gz'))
  await manager.exec(profile.id, "rm -rf '/tmp/dsh archive test'", { timeoutMs: 5000 })

  response = await call(`/api/ssh/files?connection=${profile.id}&path=/tmp`)
  body = await json(response)
  assert.equal(body.ok, true)
  assert.ok(body.entries.length > 0)

  const uploadPath = `/tmp/dsh-ssh-test/route-upload-${Date.now()}.txt`
  response = await call(`/api/ssh/upload?connection=${profile.id}&path=${encodeURIComponent(uploadPath)}`, {
    method: 'POST',
    body: Buffer.from('route upload body'),
  })
  body = await json(response)
  assert.equal(body.ok, true)
  assert.equal(body.size, 17)

  response = await call(`/api/ssh/download?connection=${profile.id}&path=${encodeURIComponent(uploadPath)}`)
  assert.equal(response.status, 200)
  const downloaded = await response.text()
  assert.equal(downloaded, 'route upload body')
  assert.ok((response.headers.get('content-disposition') ?? '').includes('attachment'))

  response = await call('/api/ssh', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ op: 'remove', id: profile.id, path: uploadPath }),
  })
  assert.equal((await json(response)).ok, true)

  response = await call(`/api/ssh/files?connection=${profile.id}&path=/definitely-not-here-${Date.now()}`)
  body = await json(response)
  assert.equal(body.ok, false)
  assert.match(body.error, /Cannot list/)

  response = await call('/api/ssh', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ op: 'nope' }),
  })
  body = await json(response)
  assert.equal(body.ok, false)

  console.log('ROUTES TEST PASS')
} finally {
  manager.dispose()
}
