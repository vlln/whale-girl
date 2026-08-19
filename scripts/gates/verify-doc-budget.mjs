// 门禁：常驻文件字数上限（verify-doc-budget）。
// 拒绝不变量：常驻规则文件的字符数超过声明上限——「字数上限是强制机制而非建议」
// （deep-standard 法则 1：常驻文件必须受门禁守护，红了以后搬迁→压缩→才抬阈值）。
// 只读、确定性。
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = resolve(import.meta.dirname, '../..')

/**
 * 常驻文件字数上限（字符数，含换行）。上限是护栏不是压缩目标：至少保留 5% 余量。
 * 提升上限须作为独立有理由的决定（deep-standard 反模式：为变绿而放宽门禁）。
 */
export const BUDGETS = {
  'AGENTS.md': 6000,          // 根常驻：L2 核心规则
  'docs/AGENTS.md': 2200,     // 文档标准
  'decisions/README.md': 5500, // 决策记录契约
  'README.md': 9000,          // 产品入口（英文主文件，2026-08 起双语：拉丁字符密度高，上限从 6500 上调并保留余量）
  'README.zh.md': 6500,       // 产品入口中文版（沿用原 README 上限；CJK 码元数 ≈ 字节/3）
}

/** 校验常驻文件字数。返回 { ok, errors }。 */
export function check(root = ROOT) {
  const errors = []
  for (const [rel, limit] of Object.entries(BUDGETS)) {
    const file = join(root, rel)
    let size
    try {
      size = readFileSync(file, 'utf8').length
    } catch {
      errors.push(`${rel}: 无法读取（文件缺失）`)
      continue
    }
    if (size > limit) {
      errors.push(`${rel}: ${size} 字符 > 上限 ${limit}（超 ${size - limit}——先搬迁/压缩，最后才抬阈值且须独立说明理由）`)
    }
  }
  return { ok: errors.length === 0, errors }
}

// CLI 入口（被 import 时不执行）。
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { ok, errors } = check()
  for (const e of errors) console.error(`[verify-doc-budget] ${e}`)
  if (!ok) {
    console.error(`[verify-doc-budget] ${errors.length} 处违规`)
    process.exit(1)
  }
  console.log('[verify-doc-budget] OK（常驻文件字数在预算内）')
}
