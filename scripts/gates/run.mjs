// 门禁编排器：门禁清单的唯一归属（AGENTS.md 与文档不手抄门禁列表，只链接本文件）。
// 用法：
//   node scripts/gates/run.mjs               # 本地精选组
//   node scripts/gates/run.mjs --group ci    # CI 全量组
//   node scripts/gates/run.mjs <gate-name>   # 单独跑一个门禁
// 失败聚合：收集全部失败后统一报告，不首个失败即中止。
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '../..')

/** 门禁清单（权威）。group: local = 本地精选组；ci = CI 全量组（含 local）。 */
const GATES = [
  { name: 'verify-md-links', group: 'local', args: ['scripts/gates/verify-md-links.mjs'] },
  { name: 'verify-decisions', group: 'local', args: ['scripts/gates/verify-decisions.mjs'] },
  { name: 'verify-assets', group: 'local', args: ['scripts/gates/verify-assets.mjs'] },
  { name: 'verify-spec-states', group: 'local', args: ['scripts/gates/verify-spec-states.mjs'] },
  { name: 'verify-config-sync', group: 'local', args: ['scripts/gates/verify-config-sync.mjs'] },
  { name: 'verify-routes-sync', group: 'local', args: ['scripts/gates/verify-routes-sync.mjs'] },
  { name: 'verify-client-seams', group: 'local', args: ['scripts/gates/verify-client-seams.mjs'] },
  { name: 'verify-i18n', group: 'local', args: ['scripts/gates/verify-i18n.mjs'] },
  { name: 'verify-gate-self-coverage', group: 'local', args: ['scripts/gates/verify-gate-self-coverage.mjs'] },
  { name: 'verify-settings-schema', group: 'local', args: ['scripts/gates/verify-settings-schema.mjs'] },
  { name: 'verify-doc-budget', group: 'local', args: ['scripts/gates/verify-doc-budget.mjs'] },
  { name: 'verify-prose', group: 'local', args: ['scripts/gates/verify-prose.mjs'] },
  { name: 'check-generated', group: 'local', args: ['scripts/build-client.mjs', '--check'] },
  { name: 'unit-tests', group: 'ci', args: ['--test', 'tests/*.test.mjs'] },
  { name: 'tool-tests', group: 'ci', runner: 'python3', args: ['tests/slice-sheet.test.py'] },
  { name: 'gate-self-tests', group: 'ci', args: ['--test', 'scripts/gates/*.test.mjs'] },
]

function usage() {
  console.error('用法: node scripts/gates/run.mjs [--group local|ci] | [gate-name]')
  process.exit(2)
}

const groupArg = process.argv.indexOf('--group')
let selected = null
if (groupArg !== -1) {
  const group = process.argv[groupArg + 1]
  if (group !== 'local' && group !== 'ci') usage()
  selected = GATES.filter((g) => (group === 'ci' ? true : g.group === 'local'))
} else if (process.argv[2]) {
  selected = GATES.filter((g) => g.name === process.argv[2])
  if (selected.length === 0) usage()
} else {
  selected = GATES.filter((g) => g.group === 'local')
}

const failed = []
for (const gate of selected) {
  const runner = gate.runner ?? process.execPath
  const res = spawnSync(runner, gate.args, { cwd: ROOT, stdio: 'inherit', encoding: 'utf8' })
  if (res.status !== 0) failed.push(gate.name)
}
if (failed.length > 0) {
  console.error(`[gates] ${failed.length}/${selected.length} 个门禁失败：${failed.join(', ')}`)
  process.exit(1)
}
console.log(`[gates] ${selected.length} 个门禁全部通过`)
