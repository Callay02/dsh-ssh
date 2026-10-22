import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { build } from 'esbuild'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const result = await build({
  absWorkingDir: root,
  entryPoints: ['client/src/index.jsx'],
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'browser',
  target: ['es2020'],
  jsx: 'transform',
  external: ['react'],
  loader: { '.css': 'text' },
  define: { 'process.env.NODE_ENV': '"production"' },
  minify: false,
  sourcemap: false,
  charset: 'utf8',
  legalComments: 'none',
  logLevel: 'warning',
})

const code = result.outputFiles[0].text
const wrapped = `/* Built from client/src — run "npm run build" after editing. */
window.__ModuleLoader__.load({
  id: "dsh-ssh-plugin",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    (function (module, exports, require) {
${code}
    })(module, exports, require);
    return module.exports;
  }
});
`
fs.writeFileSync(join(root, 'client.js'), wrapped)
console.log(`client.js written (${(wrapped.length / 1024).toFixed(1)} KiB)`)
