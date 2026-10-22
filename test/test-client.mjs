import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import React from 'react'
import { createRoot } from 'react-dom/client'

const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
  url: 'http://127.0.0.1:60002/',
  pretendToBeVisual: true,
})
globalThis.window = dom.window
globalThis.document = dom.window.document
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
globalThis.localStorage = dom.window.localStorage
globalThis.HTMLElement = dom.window.HTMLElement
globalThis.Node = dom.window.Node
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window)
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

let registration
window.__ModuleLoader__ = { load(value) { registration = value } }
await import('../client.js')
assert.equal(registration.id, '@local/dsh-ssh')
const exports = registration.factory((name) => {
  if (name === 'react') return React
  throw new Error(`unexpected require: ${name}`)
})
assert.equal(typeof exports.apply, 'function')
assert.deepEqual(exports.inject, ['slots', 'sidebarRight', 'sidebarRightTabs', 'locale'])

const types = []
const components = []
const opened = []
const localeListeners = new Set()
let localeActive = 'en'
const locale = {
  getSnapshot() { return { active: localeActive } },
  subscribe(listener) {
    localeListeners.add(listener)
    return () => localeListeners.delete(listener)
  },
  set(value) {
    localeActive = value
    for (const listener of localeListeners) listener()
  },
}
const ctx = {
  effect(callback) {
    return callback()
  },
  slots: {
    inject(_name, callback) { callback() },
    register(options, component) {
      components.push({ options, component })
      return () => {}
    },
  },
  sidebarRightTabs: {
    register(definition) {
      types.push(definition)
      return () => {}
    },
  },
  sidebarRight: {
    mounted: {
      subscribe() { return () => {} },
      getSnapshot() { return 'session-1' },
    },
    openTab(kind) { opened.push(kind) },
  },
  locale,
}
exports.apply(ctx)

assert.equal(types.length, 1, 'registers one sidebar tab type')
assert.equal(types[0].kind, 'ssh')
assert.equal(types[0].multiple, false)
assert.equal(types[0].keepMounted, true)
assert.equal(types[0].guide[0].id, 'ssh')
assert.equal(types[0].id, components.find((row) => row.options.name === 'sidebar.right.pane.tab')?.options.key)

const launcherRow = components.find((row) => row.options.id === 'ssh-launcher')
assert.ok(launcherRow, 'registers the floating launcher')
assert.equal(document.querySelectorAll('style[data-dsh-ssh]').length, 1)
assert.ok(document.head.textContent.includes('.dsh-ssh-sidebar'), 'sidebar styles are injected')
assert.ok(document.head.textContent.includes('.xterm'), 'xterm styles are bundled')

const container = document.createElement('div')
document.body.append(container)
const root = createRoot(container)
const launcherProps = launcherRow.options.inject()
await React.act(async () => {
  root.render(React.createElement(launcherRow.component, launcherProps))
})
const launcher = container.querySelector('.dsh-ssh-launcher')
assert.ok(launcher, 'launcher renders for a mounted session')
assert.match(launcher.title, /right sidebar/, 'English copy follows the en locale')

await React.act(async () => {
  locale.set('zh')
})
assert.match(container.querySelector('.dsh-ssh-launcher').title, /右侧栏/, 'copy switches live to Chinese')

await React.act(async () => {
  container.querySelector('.dsh-ssh-launcher').click()
})
assert.deepEqual(opened, ['ssh'], 'launcher opens the SSH sidebar tab')

await React.act(async () => {
  root.unmount()
})
console.log('CLIENT SMOKE PASS')
