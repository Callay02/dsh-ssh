import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import { SshManager } from '../host/manager.js'
import { registerTools } from '../host/tools.js'

const TEST_USER = process.env.USER || os.userInfo().username
const dataDir = '/tmp/dsh-ssh-test/tools-data'
await fsp.rm(dataDir, { recursive: true, force: true })
const manager = new SshManager({ dataDir, connectTimeoutMs: 8000 })
const tools = new Map()
const ctx = {
  tools: { register(definition) { tools.set(definition.name, definition) } },
  get() { return undefined },
}
registerTools(ctx, manager)
assert.deepEqual([...tools.keys()].sort(), [
  'ssh_connect', 'ssh_download', 'ssh_exec', 'ssh_files', 'ssh_list', 'ssh_upload',
])

const execCtx = { signal: undefined }
const text = (value) => value.text
let profile
let remote
let target
try {
  const saved = manager.upsert({
    name: 'tools-test', host: '127.0.0.1', port: 2222, username: TEST_USER, auth: 'key',
    privateKeyPath: '/tmp/dsh-ssh-test/client_ed25519',
  })
  profile = saved.id

  let result = await tools.get('ssh_list').execute({}, execCtx)
  assert.match(text(result), /tools-test/)

  result = await tools.get('ssh_exec').execute({ connection: 'tools-test', command: 'echo TOOL_OK' }, execCtx)
  assert.match(text(result), /TOOL_OK/)

  result = await tools.get('ssh_connect').execute({ connection: 'tools-test' }, execCtx)
  assert.match(text(result), /Connected/)

  const local = 'test/tmp-tool-source.txt'
  await fsp.writeFile(local, 'tool transfer')
  remote = `/tmp/dsh-ssh-test/tool-remote-${Date.now()}.txt`
  result = await tools.get('ssh_upload').execute({ connection: 'tools-test', localPath: local, remotePath: remote }, execCtx)
  assert.match(text(result), /Uploaded 13 bytes/)

  result = await tools.get('ssh_files').execute({ connection: 'tools-test', path: '/tmp/dsh-ssh-test' }, execCtx)
  assert.match(text(result), new RegExp(remote.split('/').pop()))

  target = 'test/tmp-tool-download.txt'
  result = await tools.get('ssh_download').execute({ connection: 'tools-test', remotePath: remote, localPath: target }, execCtx)
  assert.match(text(result), /Downloaded 13 bytes/)
  assert.equal(await fsp.readFile(target, 'utf8'), 'tool transfer')

  await assert.rejects(
    tools.get('ssh_upload').execute({ connection: 'tools-test', localPath: '/etc/hosts', remotePath: '/tmp/never' }, execCtx),
    /inside the Session working directory/,
  )
  await assert.rejects(
    tools.get('ssh_download').execute({ connection: 'tools-test', remotePath: remote, localPath: '/etc/dsh-never' }, execCtx),
    /inside the Session working directory/,
  )

  result = await tools.get('ssh_connect').execute({ connection: 'tools-test', disconnect: true }, execCtx)
  assert.match(text(result), /Disconnected/)
  console.log('TOOLS TEST PASS')
} finally {
  manager.dispose()
  await fsp.rm('test/tmp-tool-source.txt', { force: true }).catch(() => {})
  await fsp.rm('test/tmp-tool-download.txt', { force: true }).catch(() => {})
  await fsp.rm(dataDir, { recursive: true, force: true }).catch(() => {})
}
