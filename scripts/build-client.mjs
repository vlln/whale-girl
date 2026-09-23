// 生成器：lib/client/index.mjs → lib/client.js（bundle 产物，随插件分发）。
// 契约：--check 模式在内存生成后与已提交 lib/client.js 逐字节比对，不一致非零退出——
// 手改生成物禁止（改 client/index.mjs，勿改 client.js）。
// esbuild 经 .bin CLI 调用（pnpm 布局下 require.resolve 不可靠）；解析顺序：
// 本地 node_modules/.bin → $DSH_CHECKOUT/node_modules/.bin → /tmp/dsh-0808/node_modules/.bin；
// win32 下 .bin/esbuild 是 sh shim 不可 spawn——改走 node_modules/esbuild/bin/esbuild
// （node 启动 JS wrapper，平台自选原生二进制）。
// 全部缺失时明确跳过并说明（该门禁声明消费构建产物，缺失外部工具时跳过而非假装通过）。
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = resolve(import.meta.dirname, '..')
const ENTRY = 'lib/client/index.mjs'
const OUTPUT = join(ROOT, 'lib', 'client.js')

function resolveEsbuildBin() {
  const candidates = [
    join(ROOT, 'node_modules/.bin/esbuild'),
    ...(process.env.DSH_CHECKOUT ? [join(process.env.DSH_CHECKOUT, 'node_modules/.bin/esbuild')] : []),
    '/tmp/dsh-0808/node_modules/.bin/esbuild',
  ]
  for (const p of candidates) {
    try {
      if (statSync(p).isFile()) return p
    } catch {
      // 下一个候选
    }
  }
  return null
}

/**
 * 解析 esbuild 调用（跨平台）：
 * - win32 下 `.bin/esbuild` 是 POSIX sh shim（spawnSync 不可执行且 res.stderr
 *   为 undefined，直崩 TypeError）——改走 esbuild 包的 JS wrapper
 *   `node_modules/esbuild/bin/esbuild`（node 启动，平台自选原生二进制）。
 * - POSIX 下 sh shim 与 JS wrapper 均可，优先 shim（既有行为）。
 * @returns {{ cmd: string, prefix: string[] } | null} 命令与前缀参数；全部缺失返回 null。
 */
function resolveEsbuildCommand() {
  const sh = resolveEsbuildBin()
  if (sh !== null && process.platform !== 'win32') return { cmd: sh, prefix: [] }
  for (const js of [
    join(ROOT, 'node_modules/esbuild/bin/esbuild'),
    ...(process.env.DSH_CHECKOUT ? [join(process.env.DSH_CHECKOUT, 'node_modules/esbuild/bin/esbuild')] : []),
  ]) {
    try {
      if (statSync(js).isFile()) return { cmd: process.execPath, prefix: [js] }
    } catch {
      // 下一个候选
    }
  }
  return null
}

/** esbuild 是否可用（自证测试据此决定跳过）。 */
export function esbuildAvailable() {
  return resolveEsbuildCommand() !== null
}

/**
 * 生成 client.js（标准 bundle client——官方 `__ModuleLoader__.load` 契约，0811 形态：
 * factory 返回 `{ name, apply }`，由 client 内核挂载时调用 apply(ctx)。不再走
 * entry 的 UI 路由 + tapIndex 注入缝（repository 形态已随 0811 移除）。
 * 包装方式：esbuild CJS 输出（module/exports 供 factory 作用域）+ 外层
 * `__ModuleLoader__.load({ id, factory })`（对齐官方 client bundle 产物结构）。
 * @param {{ check?: boolean, root?: string }} opts
 * @returns {{ ok: boolean, errors?: string[], skipped?: string }}
 */
export function generate({ check = false, root = ROOT } = {}) {
  const esbuild = resolveEsbuildCommand()
  if (esbuild === null) {
    return { ok: true, skipped: 'esbuild 不可用：设置 DSH_CHECKOUT 指向 dsh checkout，或在仓库内安装 devDependencies' }
  }
  const tmpDir = mkdtempSync(join(tmpdir(), 'whale-girl-'))
  const tmpOut = join(tmpDir, 'client.js')
  const res = spawnSync(
    esbuild.cmd,
    [
      ...esbuild.prefix,
      ENTRY,
      '--bundle',
      '--format=cjs',
      '--platform=browser',
      '--target=es2020',
      '--external:react',
      `--outfile=${tmpOut}`,
    ],
    { cwd: root, encoding: 'utf8' },
  )
  if (res.status !== 0) {
    return { ok: false, errors: [`esbuild 失败：${(res.stderr ?? res.error ?? 'unknown error').toString().trim()}`] }
  }
  const body = readFileSync(tmpOut, 'utf8')
  const code = Buffer.from(
    `window.__ModuleLoader__.load({\n`
    + `\tid: "whale-girl",\n`
    + `\tfactory: (require) => {\n`
    + `\t\tvar module = { exports: {} };\n`
    + `\t\tvar exports = module.exports;\n`
    + body.replace(/\n$/, '')
    + `\n\t\treturn module.exports;\n`
    + `\t}\n`
    + `});\n`,
  )
  const outputPath = join(root, 'lib', 'client.js')
  if (!check) {
    writeFileSync(outputPath, code)
    return { ok: true }
  }
  let committed = null
  try {
    committed = readFileSync(outputPath)
  } catch {
    return { ok: false, errors: [`${outputPath} 不存在：运行 node scripts/build-client.mjs 生成`] }
  }
  if (Buffer.compare(committed, code) !== 0) {
    return { ok: false, errors: ['client.js 与生成器输出不一致：运行 node scripts/build-client.mjs 重新生成（手改生成物禁止）'] }
  }
  return { ok: true }
}

// CLI 入口（被 import 时不执行）。
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const check = process.argv.includes('--check')
  const result = generate({ check })
  if (result.skipped !== undefined) {
    console.log(`[build-client] SKIP：${result.skipped}`)
    process.exit(0)
  }
  if (!result.ok) {
    for (const e of result.errors ?? []) console.error(`[build-client] ${e}`)
    process.exit(1)
  }
  console.log(check ? '[build-client] client.js 新鲜（--check OK）' : '[build-client] client.js 已生成')
}
