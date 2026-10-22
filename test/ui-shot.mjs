import fs from 'node:fs'
import os from 'node:os'
import { createHash, createHmac } from 'node:crypto'
import { chromium } from 'playwright-core'

const BASE = process.env.DSH_WEB_URL || 'http://127.0.0.1:60002'
const AUTHORITY = new URL(BASE).host
const TEST_USER = process.env.USER || os.userInfo().username

function browserCookie() {
  let inRecord = false
  let secretB64 = ''
  const credentials = process.env.DSH_HOME ? `${process.env.DSH_HOME}/.credentials.yaml` : `${process.env.HOME}/.dsh/.credentials.yaml`
  for (const line of fs.readFileSync(credentials, 'utf8').split('\n')) {
    if (line.startsWith('  client-connection/browser-session:')) {
      inRecord = true
      continue
    }
    if (inRecord) {
      const match = line.match(/^\s+secret:\s*(\S+)/)
      if (match) {
        secretB64 = match[1]
        break
      }
      if (line.startsWith('  ') && !line.startsWith('    ')) break
    }
  }
  if (!secretB64) throw new Error('browser-session secret not found')
  const secret = Buffer.from(secretB64, 'base64url')
  const now = Date.now()
  const payload = { version: 1, authority: AUTHORITY, issuedAt: now, expiresAt: now + 86400000 }
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = createHmac('sha256', secret).update(body).digest('base64url')
  const name = 'dsh-auth-' + createHash('sha256').update(AUTHORITY).digest('base64url')
  return { name, value: `v1.${body}.${signature}` }
}

fs.mkdirSync('test/shots', { recursive: true })
const { name, value } = browserCookie()
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-gpu'],
})
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
await context.addCookies([{ name, value, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Strict' }])
const page = await context.newPage()
const errors = []
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(`console: ${message.text()}`)
})

await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(3500)
const welcome = page.getByRole('button', { name: /继续|Continue/ })
if (await welcome.count()) {
  await welcome.first().click()
  await page.waitForTimeout(500)
}
await page.screenshot({ path: 'test/shots/01-chat.png' })
console.log('title', await page.title())
console.log('chat textareas', await page.locator('textarea').count())

const launcher = page.locator('.dsh-ssh-launcher')
console.log('launcher', await launcher.count())
if ((await launcher.count()) === 0) throw new Error('SSH launcher is not visible')
await launcher.click()
await page.waitForTimeout(1500)
console.log('sidebar', await page.locator('.dsh-ssh-sidebar').count())
console.log('connection select', await page.locator('.dsh-ssh-conn-select').count())
await page.screenshot({ path: 'test/shots/02-sidebar.png' })

let testSelected = false
const hasVerify = await page.evaluate(() => [...document.querySelectorAll('.dsh-ssh-conn-select option')].some((option) => option.textContent.startsWith('verify-local')))
if (!hasVerify) {
  const add = page.getByRole('button', { name: /新建连接|New connection/ }).first()
  await add.click()
  await page.waitForTimeout(500)
  await page.fill('input[name=ssh-name]', 'verify-local')
  await page.fill('input[name=ssh-host]', '127.0.0.1')
  await page.fill('input[name=ssh-port]', '2222')
  await page.fill('input[name=ssh-username]', TEST_USER)
  await page.fill('input[name=ssh-key]', '/tmp/dsh-ssh-test/client_ed25519')
  await page.fill('input[name=ssh-default-dir]', '/tmp')
  await page.screenshot({ path: 'test/shots/03-connection-form.png' })
  await page.getByRole('button', { name: /^保存$|^Save$/ }).click()
  await page.waitForTimeout(1200)
  testSelected = true
} else {
  const value = await page.evaluate(() => {
    const option = [...document.querySelectorAll('.dsh-ssh-conn-select option')].find((row) => row.textContent.startsWith('verify-local'))
    return option?.value
  })
  await page.locator('.dsh-ssh-conn-select').selectOption(value)
  await page.waitForTimeout(600)
  testSelected = true
}
const selectedLabel = await page.locator('.dsh-ssh-conn-select option:checked').textContent()
console.log('selected', selectedLabel)
if (!selectedLabel?.startsWith('verify-local')) throw new Error('test connection is not selected')

const connect = page.locator('.dsh-ssh-sidebar-meta button').first()
console.log('connect label', await connect.textContent())
if (!/断开|Disconnect/.test((await connect.textContent()) ?? '')) {
  await connect.click()
  await page.waitForTimeout(1800)
}

const terminalButton = page.locator('.dsh-ssh-sidebar-meta button').nth(1)
await terminalButton.click()
await page.waitForTimeout(1800)
await page.waitForTimeout(3600)
await page.screenshot({ path: 'test/shots/04-sidebar-terminal.png' })
console.log('visible terminal hosts', await page.locator('.dsh-ssh-term-host:visible').count())
console.log('stats', (await page.locator('.dsh-ssh-term-stats').textContent().catch(() => '(none)'))?.replace(/\s+/g, ' ').trim())

if (await page.locator('.dsh-ssh-term-host:visible').count()) {
  await page.locator('.dsh-ssh-term-host:visible').first().click()
  await page.keyboard.type("printf 'SIDEBAR_UI_OK\\n'\n", { delay: 15 })
  await page.waitForTimeout(1500)
  await page.screenshot({ path: 'test/shots/05-sidebar-terminal-command.png' })
}

// Collapse and reopen the sidebar: the tab body stays mounted and the shell
// output is recovered from the Host buffer.
const collapse = page.getByRole('button', { name: /收起右侧边栏|Collapse right sidebar/ })
if (await collapse.count()) {
  await collapse.first().click()
  await page.waitForTimeout(900)
  const expand = page.getByRole('button', { name: /打开右侧边栏|Expand right sidebar/ })
  if (await expand.count()) {
    await expand.first().click()
    await page.waitForTimeout(1600)
  }
  await page.screenshot({ path: 'test/shots/05b-reopened.png' })
}

const filesButton = page.locator('.dsh-ssh-sidebar-meta').getByRole('button', { name: /^文件$|^Files$/ })
await filesButton.click()
await page.waitForTimeout(1500)
await page.screenshot({ path: 'test/shots/06-sidebar-files.png' })
console.log('file rows', await page.locator('.dsh-ssh-file-row').count())

const fileInput = page.locator('.dsh-ssh-files input[type=file]')
await fileInput.setInputFiles('test/fixture-upload.txt')
await page.waitForTimeout(1800)
const uploadedRow = page.locator('.dsh-ssh-file-row', { hasText: 'fixture-upload.txt' })
console.log('uploaded row', await uploadedRow.count())
if (await uploadedRow.count()) {
  await uploadedRow.hover()
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    uploadedRow.getByRole('button', { name: /下载|Download/ }).click(),
  ])
  await download.saveAs('test/shots/downloaded-fixture.txt')
  console.log('download suggested', download.suggestedFilename())
}

// Folder archive download.
const folderRow = page.locator('.dsh-ssh-file-row.is-dir', { hasText: 'dsh-ssh-test' }).first()
if (await folderRow.count()) {
  await folderRow.hover()
  const [archive] = await Promise.all([
    page.waitForEvent('download'),
    folderRow.getByRole('button', { name: /打包下载|Download folder/ }).click(),
  ])
  await archive.saveAs('test/shots/archive.tar.gz')
  const bytes = fs.readFileSync('test/shots/archive.tar.gz')
  console.log('archive', archive.suggestedFilename(), 'gzip', bytes[0] === 0x1f && bytes[1] === 0x8b)
}

// Edit form, then remove only the test connection. Never let cleanup touch a
// real user connection if the selection changed while the test ran.
const selectedBeforeCleanup = await page.locator('.dsh-ssh-conn-select option:checked').textContent()
if (!selectedBeforeCleanup?.startsWith('verify-local')) {
  throw new Error(`refusing cleanup: active connection is ${JSON.stringify(selectedBeforeCleanup)}`)
}
await page.getByRole('button', { name: /编辑连接|Edit connection/ }).click()
await page.waitForTimeout(500)
await page.screenshot({ path: 'test/shots/07-sidebar-edit-form.png' })
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
await page.getByRole('button', { name: /删除连接|Remove connection/ }).click()
await page.waitForTimeout(400)
await page.getByRole('button', { name: /^删除$|^Remove$/ }).last().click()
await page.waitForTimeout(800)
console.log('verify-local removed', !(await page.evaluate(() => [...document.querySelectorAll('.dsh-ssh-conn-select option')].some((option) => option.textContent.startsWith('verify-local')))))
console.log('errors', errors.slice(0, 10))
await Promise.race([browser.close(), new Promise((resolve) => setTimeout(resolve, 3000))])
process.exit(0)
