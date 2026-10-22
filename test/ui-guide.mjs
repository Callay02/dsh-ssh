import fs from 'node:fs'
import { createHash, createHmac } from 'node:crypto'
import { chromium } from 'playwright-core'
const BASE = process.env.DSH_WEB_URL || 'http://127.0.0.1:49610'
const AUTHORITY = new URL(BASE).host
function browserCookie(){let inside=false,s='';const credentials = process.env.DSH_HOME ? `${process.env.DSH_HOME}/.credentials.yaml` : `${process.env.HOME}/.dsh/.credentials.yaml`
for(const line of fs.readFileSync(credentials,'utf8').split('\n')){if(line.startsWith('  client-connection/browser-session:')){inside=true;continue}if(inside){const m=line.match(/^\s+secret:\s*(\S+)/);if(m){s=m[1];break}if(line.startsWith('  ')&&!line.startsWith('    '))break}}const secret=Buffer.from(s,'base64url');const now=Date.now();const body=Buffer.from(JSON.stringify({version:1,authority:AUTHORITY,issuedAt:now,expiresAt:now+86400000})).toString('base64url');const sig=createHmac('sha256',secret).update(body).digest('base64url');return{name:'dsh-auth-'+createHash('sha256').update(AUTHORITY).digest('base64url'),value:`v1.${body}.${sig}`}}
const {name,value}=browserCookie()
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--no-sandbox']})
const context=await browser.newContext({viewport:{width:1440,height:900}})
await context.addCookies([{name,value,domain:'127.0.0.1',path:'/',httpOnly:true,sameSite:'Strict'}])
const page=await context.newPage()
const errors=[]; page.on('console',m=>{if(m.type()==='error')errors.push(m.text())}); page.on('pageerror',e=>errors.push(e.message))
await page.goto(BASE+'/',{waitUntil:'domcontentloaded'}); await page.waitForTimeout(3000)
const welcome=page.getByRole('button',{name:/继续|Continue/}); if(await welcome.count()){await welcome.first().click(); await page.waitForTimeout(400)}
const expand=page.getByRole('button',{name:/打开右侧边栏|Expand right sidebar/}); if(await expand.count()){await expand.first().click(); await page.waitForTimeout(600)}
const add=page.getByRole('button',{name:/新标签页|New tab/})
if (await add.count()) { await add.first().click(); await page.waitForTimeout(900) }
await page.screenshot({path:'test/shots/08-guide.png'})
console.log('guide text has SSH', await page.getByText('SSH 终端',{exact:true}).count())
const card=page.getByRole('button',{name:/SSH 终端/}).first()
if (await card.count()) await card.click()
await page.waitForTimeout(1200)
console.log('sidebar from guide', await page.locator('.dsh-ssh-sidebar').count())
await page.screenshot({path:'test/shots/09-guide-opened.png'})
console.log('errors',errors.slice(0,5))
await Promise.race([browser.close(), new Promise((resolve) => setTimeout(resolve, 3000))])
process.exit(0)
