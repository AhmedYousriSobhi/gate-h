/* eslint-disable @typescript-eslint/explicit-function-return-type -- plain JS, nothing to annotate */
// Renders docs/assets/annotated/src/*.html to docs/assets/annotated/*.png.
// Run with the repo's Electron as the main script (no extra dependency):
//   env -u ELECTRON_RUN_AS_NODE node_modules/.bin/electron scripts/render-annotated.mjs [name...]
import { app, BrowserWindow } from 'electron'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// Software rendering: the GPU process is flaky on headless hosts and isn't needed for a screenshot.
app.disableHardwareAcceleration()

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const srcDir = join(root, 'docs', 'assets', 'annotated', 'src')
const outDir = join(root, 'docs', 'assets', 'annotated')
const WIDTH = 1400

// Pages write `<i data-i="cpu" data-s="13"></i>`; swap each for the real lucide-react glyph the
// app uses, read from node_modules, so the mockups carry the same icons.
async function iconSvg(name, size) {
  const file = join(root, 'node_modules', 'lucide-react', 'dist', 'esm', 'icons', `${name}.mjs`)
  const { __iconData } = await import(pathToFileURL(file).href)
  const nodes = __iconData.node
  const inner = nodes
    .map(([tag, attrs]) => {
      return `<${tag} ${Object.entries(attrs)
        .filter(([k]) => k !== 'key')
        .map(([k, v]) => `${k}="${v}"`)
        .join(' ')}/>`
    })
    .join('')
  return `<svg class="ic" xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`
}

async function render(name) {
  const win = new BrowserWindow({
    show: false,
    width: WIDTH,
    height: 900,
    useContentSize: true,
    webPreferences: { offscreen: false, backgroundThrottling: false }
  })
  // The second load in a process occasionally fails with ERR_FAILED; a retry succeeds.
  for (let attempt = 1; ; attempt++) {
    try {
      await win.loadFile(join(srcDir, `${name}.html`))
      break
    } catch (err) {
      if (attempt === 3) throw err
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }
  const html = readFileSync(join(srcDir, `${name}.html`), 'utf8')
  const icons = {}
  for (const m of html.matchAll(/data-i="([a-z0-9-]+)"(?:\s+data-s="(\d+)")?/g)) {
    icons[`${m[1]}:${m[2] ?? 14}`] = await iconSvg(m[1], Number(m[2] ?? 14))
  }
  await win.webContents.executeJavaScript(`
    for (const node of document.querySelectorAll('i[data-i]')) {
      const key = node.dataset.i + ':' + (node.dataset.s || 14)
      node.outerHTML = ${JSON.stringify(icons)}[key]
    }
    window.annotate()
  `)
  const height = await win.webContents.executeJavaScript(
    'Math.ceil(document.documentElement.getBoundingClientRect().height)'
  )
  win.setContentSize(WIDTH, height)
  await new Promise((resolve) => setTimeout(resolve, 300))
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: WIDTH, height })
  writeFileSync(join(outDir, `${name}.png`), image.toPNG())
  win.destroy()
  console.log(`${name}.png ${WIDTH}x${height}`)
}

// No top-level await on whenReady: Electron waits for the main module to finish loading before
// it becomes ready, so awaiting it here would deadlock.
async function main() {
  const wanted = process.argv.slice(2).filter((a) => !a.startsWith('-') && !a.includes('/'))
  const pages = readdirSync(srcDir)
    .filter((f) => /^\d\d-.*\.html$/.test(f))
    .map((f) => f.replace(/\.html$/, ''))
    .filter((n) => wanted.length === 0 || wanted.some((w) => n.startsWith(w)))
  for (const name of pages) await render(name)
}

// Closing each page's window must not quit the app before the next page is rendered.
app.on('window-all-closed', () => {})

app
  .whenReady()
  .then(main)
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => app.quit())
