import { useSyncExternalStore } from 'react'

function normalize(value) {
  const id = String(value ?? '').toLowerCase()
  return id.startsWith('zh') ? 'zh' : 'en'
}

function browserLanguage() {
  if (typeof navigator === 'undefined') return 'en'
  return normalize(navigator.language || (navigator.languages ?? [])[0])
}

let language = browserLanguage()
let revision = 0
const listeners = new Set()

/** Apply the active DSH locale (or a test value) and re-render subscribers. */
export function setActiveLanguage(value) {
  const next = normalize(value)
  if (next === language) return
  language = next
  revision += 1
  for (const listener of listeners) listener()
}

export function activeLanguage() {
  return language
}

/** Pick between an English and a Chinese string for the active locale. */
export function t(english, chinese) {
  return language === 'zh' ? chinese : english
}

export function isZh() {
  return language === 'zh'
}

/** Subscribe a component to locale changes so its copy updates in place. */
export function useLocale() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => revision,
    () => 0,
  )
}
