/** Authenticated HTTP surface for the SSH client panel. */
export function registerRoutes(ctx, manager) {
  const connection = ctx.get('connection')
  if (!connection?.fetch?.register) return () => {}

  const disposers = []
  const register = (route) => disposers.push(connection.fetch.register(route))

  register({
    path: '/api/ssh',
    methods: ['GET', 'POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      try {
        if (request.method === 'GET') {
          const op = new URL(request.url).searchParams.get('op') ?? 'list'
          if (op === 'list') return json({ ok: true, connections: manager.list() })
          throw new Error(`Unknown operation "${op}".`)
        }
        const body = await readJson(request)
        const op = String(body.op ?? '')
        switch (op) {
          case 'save':
            return json({ ok: true, connection: manager.upsert(body.connection ?? {}) })
          case 'delete':
            return json(manager.remove(body.id))
          case 'connect':
            return json({ ok: true, connection: await manager.connect(body.id) })
          case 'disconnect':
            return json(manager.disconnect(body.id))
          case 'test':
            return json({ ok: true, ...await manager.testProfile(body.connection ?? {}) })
          case 'terminal.open':
            return json(await manager.openTerminal(body.id, { cols: body.cols, rows: body.rows, name: body.name }))
          case 'terminal.input':
            return json(manager.writeTerminal(body.terminalId, body.data))
          case 'terminal.resize':
            return json(manager.resizeTerminal(body.terminalId, body.cols, body.rows))
          case 'terminal.close':
            return json(manager.closeTerminal(body.terminalId))
          case 'terminal.list':
            return json({ ok: true, terminals: manager.listTerminals(body.id) })
          case 'mkdir':
            return json(await manager.mkdirRemote(body.id, body.path))
          case 'remove':
            return json(await manager.removeRemote(body.id, body.path))
          case 'rename':
            return json(await manager.renameRemote(body.id, body.path, body.to))
          default:
            throw new Error(`Unknown operation "${op}".`)
        }
      } catch (error) {
        return failure(error)
      }
    },
  })

  register({
    path: '/api/ssh/terminal',
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async (request) => {
      try {
        const url = new URL(request.url)
        const op = url.searchParams.get('op') ?? 'poll'
        if (op !== 'poll') throw new Error(`Unknown operation "${op}".`)
        const terminalId = url.searchParams.get('terminal') ?? ''
        const cursor = Number(url.searchParams.get('cursor') ?? '0')
        const wait = Number(url.searchParams.get('wait') ?? '0')
        if (!terminalId) throw new Error('terminal is required.')
        return json(await manager.pollTerminal(terminalId, cursor, wait))
      } catch (error) {
        return failure(error)
      }
    },
  })

  register({
    path: '/api/ssh/metrics',
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async (request) => {
      try {
        const url = new URL(request.url)
        const id = url.searchParams.get('connection') ?? ''
        if (!id) throw new Error('connection is required.')
        return json({ ok: true, metrics: await manager.getMetrics(id) })
      } catch (error) {
        return failure(error)
      }
    },
  })

  register({
    path: '/api/ssh/files',
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async (request) => {
      try {
        const url = new URL(request.url)
        const id = url.searchParams.get('connection') ?? ''
        const path = url.searchParams.get('path') ?? ''
        if (!id) throw new Error('connection is required.')
        return json({ ok: true, ...await manager.listRemote(id, path) })
      } catch (error) {
        return failure(error)
      }
    },
  })

  register({
    path: '/api/ssh/archive',
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async (request) => {
      try {
        const url = new URL(request.url)
        const id = url.searchParams.get('connection') ?? ''
        const path = url.searchParams.get('path') ?? ''
        if (!id || !path) throw new Error('connection and path are required.')
        const archive = await manager.archiveStream(id, path)
        request.signal.addEventListener('abort', () => {
          try {
            archive.stream.destroy()
          } catch {}
        }, { once: true })
        const name = archive.name.replace(/[\r\n"\\]/g, '_')
        return new Response(archive.stream, {
          status: 200,
          headers: {
            'content-type': 'application/gzip',
            'content-disposition': `attachment; filename="${asciiFallback(name)}"; filename*=UTF-8''${encodeURIComponent(name)}`,
            'cache-control': 'no-store',
          },
        })
      } catch (error) {
        return failure(error)
      }
    },
  })

  register({
    path: '/api/ssh/download',
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async (request) => {
      try {
        const url = new URL(request.url)
        const id = url.searchParams.get('connection') ?? ''
        const path = url.searchParams.get('path') ?? ''
        if (!id || !path) throw new Error('connection and path are required.')
        const download = await manager.downloadStream(id, path)
        const name = download.name.replace(/[\r\n"\\]/g, '_')
        return new Response(download.stream, {
          status: 200,
          headers: {
            'content-type': 'application/octet-stream',
            'content-length': String(download.size),
            'content-disposition': `attachment; filename="${asciiFallback(name)}"; filename*=UTF-8''${encodeURIComponent(name)}`,
            'cache-control': 'no-store',
          },
        })
      } catch (error) {
        return failure(error)
      }
    },
  })

  register({
    path: '/api/ssh/upload',
    methods: ['POST'],
    requestBody: 'streaming',
    fetch: async (request) => {
      try {
        const url = new URL(request.url)
        const id = url.searchParams.get('connection') ?? ''
        const path = url.searchParams.get('path') ?? ''
        if (!id || !path) throw new Error('connection and path are required.')
        if (!request.body) throw new Error('The upload body is empty.')
        const result = await manager.uploadStream(id, path, request.body)
        return json({ ok: true, ...result })
      } catch (error) {
        return failure(error)
      }
    },
  })

  return () => {
    for (const dispose of disposers.splice(0)) {
      try {
        dispose()
      } catch {}
    }
  }
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

function failure(error) {
  const message = error instanceof Error ? error.message : String(error)
  return json({ ok: false, error: message }, 400)
}

async function readJson(request) {
  const text = await request.text()
  if (text.length > 1024 * 1024) throw new Error('Request body is too large.')
  try {
    const parsed = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object') throw new Error('Expected a JSON object.')
    return parsed
  } catch (error) {
    throw new Error(`Invalid JSON body: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function asciiFallback(name) {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  return ascii || 'download'
}
