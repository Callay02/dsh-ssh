import fsp from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { dirname, isAbsolute, join, posix, relative, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { errorText } from './store.js'

const TEXT_OUTPUT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean' },
    text: { type: 'string' },
  },
  required: ['ok', 'text'],
}

const MAX_TRANSFER_FILES = 1000

/** Register the SSH tools the Agent can call. */
export function registerTools(ctx, manager) {
  const tool = (definition) => ctx.tools.register(registryTool(definition))

  tool({
    name: 'ssh_list',
    description: 'List SSH connections configured in the Harness SSH panel, including connection status and pinned host key fingerprint. Use this before ssh_exec to find a connection name.',
    parameters: {},
    output: {
      schema: TEXT_OUTPUT,
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute() {
      const rows = manager.list()
      if (rows.length === 0) {
        return { ok: true, text: 'No SSH connections are configured. Ask the user to add one in the SSH panel (the floating SSH button).' }
      }
      const lines = rows.map((row) => {
        const state = row.status === 'connected' ? 'connected' : row.status === 'error' ? `error: ${row.error || 'unknown'}` : row.status
        const fingerprint = row.hostFingerprint ? ` fingerprint=${row.hostFingerprint}` : ''
        return `- ${row.name} (${row.username}@${row.host}:${row.port}, auth=${row.auth}, ${state})${fingerprint}`
      })
      return { ok: true, text: `SSH connections:\n${lines.join('\n')}` }
    },
  })

  tool({
    name: 'ssh_connect',
    description: 'Establish or close an SSH connection before running commands. Most SSH tools connect automatically; use this to pre-connect or to release a connection.',
    parameters: {
      connection: { type: 'string', required: true, description: 'Connection name or id from ssh_list.' },
      disconnect: { type: 'boolean', description: 'Close the connection instead of opening it. Defaults to false.' },
    },
    output: {
      schema: TEXT_OUTPUT,
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute(args) {
      if (args.disconnect === true) {
        manager.disconnect(args.connection, { reason: 'Disconnected by the Agent.' })
        return { ok: true, text: `Disconnected ${args.connection}.` }
      }
      const row = await manager.connect(args.connection)
      return { ok: true, text: `Connected to ${row.name} (${row.username}@${row.host}:${row.port}). Host key: ${row.hostFingerprint || 'learned on this connection (trust on first use)'}.` }
    },
  })

  tool({
    name: 'ssh_exec',
    description: 'Run one non-interactive command on a remote server over SSH and return stdout, stderr and the exit code. The connection is opened automatically. Use pty:true only when the program needs a pseudo-terminal (for example sudo with a configured NOPASSWD entry). For long-lived interactive work, use the SSH panel terminal instead.',
    parameters: {
      connection: { type: 'string', required: true, description: 'Connection name or id from ssh_list.' },
      command: { type: 'string', required: true, description: 'Command line to run through the remote user\'s login shell.' },
      timeoutMs: { type: 'number', description: 'Timeout in milliseconds (1000–3600000). Defaults to the plugin configuration.' },
      pty: { type: 'boolean', description: 'Allocate a pseudo-terminal for the command. Defaults to false.' },
    },
    output: {
      schema: TEXT_OUTPUT,
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute(args, exec) {
      const result = await manager.exec(args.connection, args.command, {
        timeoutMs: args.timeoutMs,
        pty: args.pty === true,
        signal: exec.signal,
      })
      const lines = [`exit code: ${result.code ?? 'unknown'}${result.timedOut ? ' (timed out)' : ''}${result.aborted ? ' (cancelled)' : ''}`]
      if (result.stdout) lines.push('stdout:', result.stdout)
      if (result.stderr) lines.push('stderr:', result.stderr)
      if (!result.stdout && !result.stderr) lines.push('(no output)')
      if (result.truncated) lines.push('[output truncated]')
      return { ok: true, text: lines.join('\n') }
    },
  })

  tool({
    name: 'ssh_upload',
    description: 'Upload a local file or directory from the Session workspace to a remote server over SFTP. Local paths must resolve inside the Session working directory.',
    parameters: {
      connection: { type: 'string', required: true, description: 'Connection name or id from ssh_list.' },
      localPath: { type: 'string', required: true, description: 'Local file or directory path, relative to the Session working directory or absolute inside it.' },
      remotePath: { type: 'string', required: true, description: 'Remote destination path. A relative path resolves against the remote home directory.' },
      recursive: { type: 'boolean', description: 'Upload a directory tree. Defaults to false.' },
    },
    output: {
      schema: TEXT_OUTPUT,
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute(args, exec) {
      const root = await sessionRoot(ctx, exec)
      const local = await resolveLocalInside(root, args.localPath, 'read')
      const info = await fsp.stat(local)
      if (info.isDirectory()) {
        if (args.recursive !== true) throw new Error('That local path is a directory. Set recursive:true to upload the tree.')
        const stats = { files: 0, bytes: 0 }
        await uploadTree(manager, args.connection, local, args.remotePath, stats, exec.signal)
        return { ok: true, text: `Uploaded ${stats.files} file(s), ${stats.bytes} bytes to ${args.remotePath}.` }
      }
      if (!info.isFile()) throw new Error('Only regular files and directories can be uploaded.')
      const result = await manager.uploadFile(args.connection, local, args.remotePath)
      return { ok: true, text: `Uploaded ${result.size} bytes to ${result.path}.` }
    },
  })

  tool({
    name: 'ssh_download',
    description: 'Download a remote file or directory to the Session workspace over SFTP. Local paths must resolve inside the Session working directory.',
    parameters: {
      connection: { type: 'string', required: true, description: 'Connection name or id from ssh_list.' },
      remotePath: { type: 'string', required: true, description: 'Remote source path. A relative path resolves against the remote home directory.' },
      localPath: { type: 'string', description: 'Local destination path inside the Session workspace. Defaults to the remote basename in the working directory.' },
      recursive: { type: 'boolean', description: 'Download a directory tree. Defaults to false.' },
    },
    output: {
      schema: TEXT_OUTPUT,
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute(args, exec) {
      const root = await sessionRoot(ctx, exec)
      const remoteInfo = await manager.statRemote(args.connection, args.remotePath)
      const suggested = args.localPath || posix.basename(remoteInfo.path)
      const local = await resolveLocalInside(root, suggested, 'write')
      if (remoteInfo.type === 'dir') {
        if (args.recursive !== true) throw new Error('That remote path is a directory. Set recursive:true to download the tree.')
        const stats = { files: 0, bytes: 0 }
        await downloadTree(manager, args.connection, remoteInfo.path, local, stats, exec.signal, [])
        return { ok: true, text: `Downloaded ${stats.files} file(s), ${stats.bytes} bytes to ${local}.` }
      }
      if (remoteInfo.type !== 'file') throw new Error('Only regular files and directories can be downloaded.')
      await fsp.mkdir(dirname(local), { recursive: true })
      const download = await manager.downloadStream(args.connection, remoteInfo.path)
      await pipeline(download.stream, createWriteStream(local))
      return { ok: true, text: `Downloaded ${download.size} bytes from ${download.path} to ${local}.` }
    },
  })

  tool({
    name: 'ssh_files',
    description: 'List one remote directory over SFTP. Use it to discover paths before ssh_download or to inspect a directory without running a shell command.',
    parameters: {
      connection: { type: 'string', required: true, description: 'Connection name or id from ssh_list.' },
      path: { type: 'string', description: 'Remote directory. Defaults to the remote home directory.' },
    },
    output: {
      schema: TEXT_OUTPUT,
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute(args) {
      const listing = await manager.listRemote(args.connection, args.path)
      const lines = [`${listing.path}:`]
      for (const entry of listing.entries.slice(0, 200)) {
        const kind = entry.type === 'dir' ? 'd' : entry.type === 'symlink' ? 'l' : '-'
        lines.push(`${kind} ${String(entry.size).padStart(10)} ${new Date(entry.mtime || Date.now()).toISOString()} ${entry.name}${entry.type === 'dir' ? '/' : ''}`)
      }
      if (listing.entries.length === 0) lines.push('(empty directory)')
      if (listing.entries.length > 200) lines.push(`[${listing.entries.length - 200} more entries not shown]`)
      return { ok: true, text: lines.join('\n') }
    },
  })
}

/**
 * Build the registry shape directly: the plugin stays independent of Harness
 * packages so it also loads from a linked workspace checkout.
 */
function registryTool(definition) {
  const properties = {}
  const required = []
  for (const [key, spec] of Object.entries(definition.parameters ?? {})) {
    const { required: isRequired, ...schema } = spec
    properties[key] = schema
    if (isRequired === true) required.push(key)
  }
  return {
    name: definition.name,
    description: definition.description,
    parameters: {
      type: 'object',
      properties,
      ...required.length > 0 ? { required } : {},
      additionalProperties: false,
    },
    output: {
      schema: definition.output.schema,
      render: definition.output.render,
    },
    async execute(args, exec) {
      const values = args ?? {}
      for (const key of required) {
        if (values[key] === undefined || values[key] === null || values[key] === '') {
          throw new Error(`${key} is required.`)
        }
      }
      return await definition.execute(values, exec)
    },
  }
}

async function sessionRoot(ctx, exec) {
  try {
    if (exec.agent !== undefined) {
      const directories = ctx.get('workingDirectory')
      if (directories) return await directories.ensure(exec.agent, exec.signal)
    }
  } catch {}
  return process.cwd()
}

async function resolveLocalInside(root, requested, mode) {
  const local = isAbsolute(requested) ? resolve(requested) : resolve(root, requested)
  const relation = relative(root, local)
  if (relation !== '' && (relation.startsWith('..') || isAbsolute(relation))) {
    throw new Error(`Local path must stay inside the Session working directory (${root}).`)
  }
  const canonicalRoot = await fsp.realpath(root).catch(() => root)
  if (mode === 'read') {
    const canonical = await fsp.realpath(local).catch(() => local)
    if (!inside(canonicalRoot, canonical)) {
      throw new Error(`Local path resolves outside the Session working directory (${root}).`)
    }
  } else {
    let ancestor = dirname(local)
    while (ancestor !== dirname(ancestor) && !(await exists(ancestor))) ancestor = dirname(ancestor)
    const canonicalParent = await fsp.realpath(ancestor).catch(() => ancestor)
    if (!inside(canonicalRoot, canonicalParent)) {
      throw new Error(`Local destination resolves outside the Session working directory (${root}).`)
    }
  }
  return local
}

function inside(root, target) {
  const relation = relative(root, target)
  return relation === '' || (!relation.startsWith('..') && !isAbsolute(relation))
}

async function exists(path) {
  try {
    await fsp.access(path)
    return true
  } catch {
    return false
  }
}

async function uploadTree(manager, connection, localDirectory, remoteDirectory, stats, signal) {
  throwIfAborted(signal)
  const entries = await fsp.readdir(localDirectory, { withFileTypes: true })
  try {
    const info = await manager.statRemote(connection, remoteDirectory)
    if (info.type !== 'dir') throw new Error(`${remoteDirectory} exists and is not a directory.`)
  } catch (error) {
    if (!/Cannot stat/.test(errorText(error))) throw error
    await manager.mkdirRemote(connection, remoteDirectory)
  }
  for (const entry of entries) {
    throwIfAborted(signal)
    if (entry.name === '.git' || entry.name === 'node_modules') continue
    const from = join(localDirectory, entry.name)
    const to = posix.join(remoteDirectory, entry.name)
    if (entry.isDirectory()) {
      await uploadTree(manager, connection, from, to, stats, signal)
    } else if (entry.isFile()) {
      if (stats.files >= MAX_TRANSFER_FILES) throw new Error(`Refusing to transfer more than ${MAX_TRANSFER_FILES} files.`)
      const result = await manager.uploadFile(connection, from, to)
      stats.files += 1
      stats.bytes += result.size
    }
  }
}

async function downloadTree(manager, connection, remoteDirectory, localDirectory, stats, signal, seen) {
  throwIfAborted(signal)
  if (seen.includes(remoteDirectory)) throw new Error(`Remote directory cycle detected at ${remoteDirectory}.`)
  seen.push(remoteDirectory)
  await fsp.mkdir(localDirectory, { recursive: true })
  const listing = await manager.listRemote(connection, remoteDirectory)
  for (const entry of listing.entries) {
    throwIfAborted(signal)
    if (entry.type === 'dir') {
      await downloadTree(manager, connection, entry.path, join(localDirectory, entry.name), stats, signal, seen)
    } else if (entry.type === 'file') {
      if (stats.files >= MAX_TRANSFER_FILES) throw new Error(`Refusing to transfer more than ${MAX_TRANSFER_FILES} files.`)
      const download = await manager.downloadStream(connection, entry.path)
      await pipeline(download.stream, createWriteStream(join(localDirectory, entry.name)))
      stats.files += 1
      stats.bytes += download.size
    }
  }
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw new Error('Transfer cancelled.')
}
