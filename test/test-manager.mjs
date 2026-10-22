import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import fsp from 'node:fs/promises'
import { Readable } from 'node:stream'
import { SshManager } from '../host/manager.js'

const TEST_USER = process.env.USER || os.userInfo().username
const dataDir = '/tmp/dsh-ssh-test/plugin-data'
await fsp.rm(dataDir, { recursive: true, force: true })

const manager = new SshManager({ dataDir, connectTimeoutMs: 8000, keepaliveIntervalMs: 5000 })
let failures = 0
const step = async (name, fn) => {
  try {
    await fn()
    console.log(`ok   ${name}`)
  } catch (error) {
    failures += 1
    console.error(`FAIL ${name}: ${error?.stack ?? error}`)
  }
}

let profile
await step('upsert profile', () => {
  profile = manager.upsert({
    name: 'test-local',
    host: '127.0.0.1',
    port: 2222,
    username: TEST_USER,
    auth: 'key',
    privateKeyPath: '/tmp/dsh-ssh-test/client_ed25519',
    defaultDir: '/tmp',
  })
  assert.equal(profile.name, 'test-local')
  assert.equal(profile.status, 'disconnected')
})

await step('connect + TOFU fingerprint', async () => {
  const row = await manager.connect(profile.id)
  assert.equal(row.status, 'connected')
  assert.ok(row.hostFingerprint.length > 20, 'fingerprint should be learned')
})

await step('exec stdout', async () => {
  const result = await manager.exec(profile.id, 'echo hello-from-ssh')
  assert.equal(result.code, 0)
  assert.equal(result.stdout.trim(), 'hello-from-ssh')
})

await step('exec stderr + exit code', async () => {
  const result = await manager.exec(profile.id, 'echo oops >&2; exit 7')
  assert.equal(result.code, 7)
  assert.equal(result.stderr.trim(), 'oops')
})

await step('exec timeout', async () => {
  const result = await manager.exec(profile.id, 'sleep 20', { timeoutMs: 1000 })
  assert.equal(result.timedOut, true)
})

await step('terminal open/write/poll', async () => {
  const opened = await manager.openTerminal(profile.id, { cols: 100, rows: 30 })
  assert.ok(opened.terminal.id)
  let cursor = 0
  let text = ''
  const deadline = Date.now() + 8000
  while (Date.now() < deadline) {
    const frame = manager.pollTerminal(opened.terminal.id, cursor, 500)
    const value = await frame
    cursor = value.cursor
    text += value.data
    if (text.includes('$') || text.includes('%') || text.includes('#')) break
  }
  manager.writeTerminal(opened.terminal.id, "printf 'TERM_OK\\n'\n")
  const t2 = Date.now() + 8000
  while (Date.now() < t2) {
    const value = await manager.pollTerminal(opened.terminal.id, cursor, 500)
    cursor = value.cursor
    text += value.data
    if (text.includes('TERM_OK')) break
  }
  assert.ok(text.includes('TERM_OK'), `terminal output did not contain marker: ${JSON.stringify(text.slice(-300))}`)
  manager.closeTerminal(opened.terminal.id)
})

await step('sftp list + mkdir', async () => {
  const listing = await manager.listRemote(profile.id, '/tmp')
  assert.ok(listing.entries.length > 0)
  const dir = `/tmp/dsh-ssh-test/remote-${Date.now()}`
  await manager.mkdirRemote(profile.id, dir)
  const after = await manager.listRemote(profile.id, dir)
  assert.equal(after.entries.length, 0)
  await manager.removeRemote(profile.id, dir)
})

await step('sftp upload + download', async () => {
  const local = '/tmp/dsh-ssh-test/upload-source.txt'
  await fsp.writeFile(local, 'ssh plugin transfer test\n'.repeat(100))
  const remote = '/tmp/dsh-ssh-test/upload-target.txt'
  const uploaded = await manager.uploadFile(profile.id, local, remote)
  assert.equal(uploaded.size, (await fsp.stat(local)).size)

  const download = await manager.downloadStream(profile.id, remote)
  const chunks = []
  for await (const chunk of download.stream) chunks.push(chunk)
  const content = Buffer.concat(chunks).toString('utf8')
  assert.equal(content, await fsp.readFile(local, 'utf8'))

  const viaWeb = '/tmp/dsh-ssh-test/upload-web.txt'
  await manager.uploadStream(profile.id, viaWeb, Readable.toWeb(Readable.from(['web upload'])) )
  const stat = await manager.statRemote(profile.id, viaWeb)
  assert.equal(stat.size, 10)
  await manager.removeRemote(profile.id, remote)
  await manager.removeRemote(profile.id, viaWeb)
})

await step('testProfile', async () => {
  const result = await manager.testProfile({ host: '127.0.0.1', port: 2222, username: TEST_USER, auth: 'key', privateKeyPath: '/tmp/dsh-ssh-test/client_ed25519' })
  assert.equal(result.ok, true)
  assert.ok(result.fingerprint)
})

await step('disconnect', async () => {
  manager.disconnect(profile.id)
  assert.equal(manager.list()[0].status, 'disconnected')
})

manager.dispose()
console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
