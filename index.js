import { SshManager } from './host/manager.js'
import { registerRoutes } from './host/routes.js'
import { registerTools } from './host/tools.js'

export const name = 'ssh'

/** Tools are the essential service; the Web routes are mounted when available. */
export const inject = ['tools']

export function apply(ctx, config = {}) {
  const manager = new SshManager(config)
  ctx.effect(() => () => manager.dispose(), 'ssh: manager')
  registerTools(ctx, manager)
  ctx.inject(['connection'], (connectionCtx) => {
    connectionCtx.effect(() => registerRoutes(connectionCtx, manager), 'ssh: web routes')
  })
}
