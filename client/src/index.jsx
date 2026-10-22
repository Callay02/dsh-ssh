import React from 'react'
import xtermCss from '@xterm/xterm/css/xterm.css'
import { css } from './style.js'
import { Launcher, SshGuideIcon, SshTabBody, TAB_ID, TAB_KIND } from './app.jsx'
import { setActiveLanguage, t } from './i18n.js'

export const inject = ['slots', 'sidebarRight', 'sidebarRightTabs', 'locale']

export function apply(ctx) {
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.dshSsh = ''
    style.textContent = `${xtermCss}\n${css}`
    document.head.append(style)
    return () => style.remove()
  }, 'ssh: styles')

  // Follow the DSH locale live: the language picker in General settings updates
  // every SSH label without a reload.
  ctx.effect(() => {
    const sync = () => setActiveLanguage(ctx.locale.getSnapshot().active)
    sync()
    return ctx.locale.subscribe(sync)
  }, 'ssh: locale')

  // A page-type tab in the right sidebar: the conversation stays visible in the
  // centre column while the terminal and SFTP browser live beside it.
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: TAB_ID,
    kind: TAB_KIND,
    multiple: false,
    keepMounted: true,
    priority: 'extension',
    title: () => t('SSH terminal', 'SSH 终端'),
    guide: [{
      id: 'ssh',
      order: 16,
      title: () => t('SSH terminal', 'SSH 终端'),
      description: () => t('Run commands and transfer files on a remote server', '在远程服务器上执行命令、传输文件'),
      icon: SshGuideIcon,
    }],
  }), 'ssh: sidebar tab type')

  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: TAB_ID,
  }, SshTabBody)), 'ssh: sidebar tab body')

  ctx.effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'ssh-launcher',
    order: 80,
    inject: () => ({
      mounted: ctx.sidebarRight.mounted,
      open: () => {
        try {
          ctx.sidebarRight.openTab(TAB_KIND)
        } catch (error) {
          console.warn('ssh: cannot open the right sidebar', error)
        }
      },
    }),
  }, Launcher)), 'ssh: launcher')
}
