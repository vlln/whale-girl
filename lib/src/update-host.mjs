/** 更新能力的宿主侧实现：读 profile 记录的安装来源与锁文件、查上游最新版本、经宿主的 profile 包管理
 * 服务执行更新。所有外部依赖都从参数进来（包管理器、网络、自身清单、profile 目录），所以状态编排与
 * `.git` 布局解析都能用真实临时目录或假实现单测；`lib/index.mjs` 只负责把 cordis 服务接进来并暴露路由。
 *
 * 术语：
 * - 当前身份 = 已安装提交（git 安装）或版本（registry 安装）。版本优先取宿主 `listBundles()` 的
 *   `BundleInfo.version`（0.2.1-alpha.2 起宿主直接给出），锁文件解析（registry 版本 / git tar.gz 提交）
 *   与自身清单版本是旧宿主的回退；git 安装下包的 package.json 版本号不随提交变化，提交只有锁文件知道。
 * - 上游 = 该安装来源那条线的最新提交/版本；本地路径安装没有上游可跟，就跟包清单声明的仓库默认分支。
 * - host-outdated = 宿主认得这个包、却既不给 `source` 也不给 `version`（0.2.0-rc.2 时代的 BundleInfo），
 *   此时无法确认宿主年代，文案引导升级；宿主给了 `version` 而没有 `source` 是「真·没有记录的来源」
 *   （如安装自带条目），按 no-source 处理，不再误导用户升级宿主。
 */
import { readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  applicationState,
  decideUpdate,
  parseInstallSource,
  readLockIdentity,
  resolveGitHead,
  shortSha,
  updateSpecs,
} from './update.mjs'

/** 更新检查的网络时限（毫秒）：只在卡片挂载或用户点按钮时发起，短时限免得界面挂着不动。 */
export const UPDATE_TIMEOUT_MS = 10000

/** 读 `<dir>/.git` 里的当前提交（没有就 undefined）。
 *
 * `.git` 可能是目录，也可能是文件：worktree / submodule 里它写着 `gitdir: <真实 git 目录>`；而
 * worktree 的分支引用通常不在自己那个 git 目录里，而在 `<gitDir>/commondir` 指的公共目录里，
 * 所以松散引用与 packed-refs 两处都要找。 */
export function readGitHead(dir, io = { readFileSync, statSync, join, resolve }) {
  try {
    let gitDir = io.join(dir, '.git')
    if (io.statSync(gitDir).isFile()) {
      const pointer = io.readFileSync(gitDir, 'utf8').trim().replace(/^gitdir:\s*/u, '')
      gitDir = io.resolve(dir, pointer)
    }
    const commonDir = (() => {
      try {
        const pointer = io.readFileSync(io.join(gitDir, 'commondir'), 'utf8').trim()
        return pointer === '' ? gitDir : io.resolve(gitDir, pointer)
      } catch {
        return gitDir
      }
    })()
    const head = io.readFileSync(io.join(gitDir, 'HEAD'), 'utf8')
    const symbolic = /^ref:\s*(\S+)$/u.exec(head.trim())
    if (symbolic !== null) {
      for (const base of commonDir === gitDir ? [gitDir] : [gitDir, commonDir]) {
        try {
          return io.readFileSync(io.join(base, symbolic[1]), 'utf8').trim()
        } catch {
          // 松散引用可能不在这里，继续找 packed-refs。
        }
      }
    }
    const packed = [gitDir, commonDir]
      .map((base) => {
        try {
          return io.readFileSync(io.join(base, 'packed-refs'), 'utf8')
        } catch {
          return ''
        }
      })
      .join('\n')
    return resolveGitHead(head, packed)
  } catch {
    return undefined
  }
}

/**
 * 建一个更新宿主。
 * @param {{self: {name: string, version?: string, repository?: object}, profileDir?: string,
 *   managerOf: () => object | undefined, fetchJson: (url: string, accept: string) => Promise<any>}} deps
 */
export function createUpdateHost({ self, profileDir, managerOf, fetchJson }) {
  /** profile 锁文件文本（读不到返回空串，调用方按「未知」处理）。 */
  function readLockText() {
    if (profileDir === undefined) return ''
    try {
      return readFileSync(join(profileDir, 'pnpm-lock.yaml'), 'utf8')
    } catch {
      return ''
    }
  }

  /** 宿主是否提供了可用的安装能力（决定这一行摆不摆更新动作）。 */
  function canInstall() {
    const manager = managerOf()
    return manager !== undefined && typeof manager.installBundle === 'function'
  }

  /** 宿主的包管理服务当前记录的自身安装来源（每次用时再取：插件可能比服务先起）。 */
  async function selfBundle() {
    const manager = managerOf()
    if (manager === undefined || typeof manager.listBundles !== 'function') return undefined
    try {
      const bundles = await manager.listBundles()
      if (!Array.isArray(bundles)) return undefined
      return bundles.find((bundle) => bundle !== null && typeof bundle === 'object' && bundle.name === self.name)
    } catch {
      return undefined
    }
  }

  /** git 安装的上游：`commits/<ref>`；没有 ref 就是仓库的默认分支。 */
  async function gitUpstream(parsed, currentSha) {
    const suffix = parsed.ref === undefined ? '' : `/${encodeURIComponent(parsed.ref)}`
    const payload = await fetchJson(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}/commits${suffix}`, 'application/vnd.github+json')
    const sha = typeof payload?.sha === 'string' ? payload.sha : undefined
    return {
      latest: sha === undefined ? {} : { sha, commit: shortSha(sha) },
      state: decideUpdate({ kind: 'git', currentSha, latestSha: sha }),
    }
  }

  /** registry 安装的上游：`dist-tags.latest`。 */
  async function registryUpstream(parsed, currentVersion) {
    const payload = await fetchJson(`https://registry.npmjs.org/${encodeURIComponent(parsed.name).replaceAll('%40', '@')}`, 'application/json')
    const version = payload?.['dist-tags']?.latest
    return { latest: { version }, state: decideUpdate({ kind: 'registry', currentVersion, latestVersion: version }) }
  }

  /** 本地路径安装的上游：跟包自己声明的仓库的默认分支（通常是 main）。
   * 包没声明仓库、或读不到默认分支名时返回 undefined，由调用方按「无法确认上游」处理——猜一条分支名
   * 会把用户的依赖指到别的线上去。 */
  async function localUpstream(localSha) {
    const repo = self.repository
    if (repo === undefined) return undefined
    const info = await fetchJson(`https://api.github.com/repos/${repo.owner}/${repo.repo}`, 'application/vnd.github+json')
    const ref = typeof info?.default_branch === 'string' && info.default_branch !== '' ? info.default_branch : undefined
    if (ref === undefined) return undefined
    const payload = await fetchJson(`https://api.github.com/repos/${repo.owner}/${repo.repo}/commits/${encodeURIComponent(ref)}`, 'application/vnd.github+json')
    const sha = typeof payload?.sha === 'string' ? payload.sha : undefined
    return {
      latest: { ...(sha === undefined ? {} : { sha, commit: shortSha(sha) }), ref, repo },
      state: decideUpdate({ kind: 'git', currentSha: localSha, latestSha: sha }),
    }
  }

  /** 当前身份 + 上游最新状态（卡片挂载或用户点「检查更新」时调用）。
   * 载荷契约（客户端只读这些）：`current.{version,commit,source}`、`latest.{version,commit,ref}`、
   * `state`、`canUpdate`、`reason`、`detail`。 */
  async function status() {
    const bundle = await selfBundle()
    // 更新目标只认 profile 记录的那条 spec：包清单里的 repository 是发布元信息，拿它当来源会把用户记的
    // 分支/标签换成另一条 spec，甚至把「安装自带的组合包」变成 profile 依赖。
    const source = typeof bundle?.source === 'string' && bundle.source !== '' ? bundle.source : undefined
    // 宿主直接给出的已安装版本（0.2.1-alpha.2 起 BundleInfo.version）：比锁文件解析更直接，
    // 锁文件读不到（损坏/新布局）时也还有版本可显示。git 安装下它仍是 package.json 版本号，
    // 提交仍只有锁文件知道。
    const bundleVersion = typeof bundle?.version === 'string' && bundle.version !== '' ? bundle.version : undefined
    const installable = canInstall()
    const identity = readLockIdentity(readLockText(), self.name)
    const current = {
      version: bundleVersion ?? identity.version ?? self.version,
      ...(source === undefined ? {} : { source }),
      ...(identity.sha === undefined ? {} : { commit: shortSha(identity.sha) }),
    }
    const unsupported = (reason) => ({ current, latest: undefined, state: 'unknown', canUpdate: false, reason })
    const settle = (upstream, currentOverride) => ({
      current: currentOverride ?? current,
      latest: upstream.latest,
      state: upstream.state,
      canUpdate: installable && upstream.state === 'update-available',
    })

    const parsed = parseInstallSource(source)
    if (parsed === undefined) {
      // 区分两种「认不出」：宿主认得这个包但既不给 source 也不给 version（旧宿主的 BundleInfo
      // 两个字段都没有）→ host-outdated，文案引导升级宿主；宿主给了 version（说明 BundleInfo 是
      // 新形状、只是没记录来源，如安装自带条目）或记录里有认不出的 spec → no-source（真·查不到上游）。
      return source === undefined && bundleVersion === undefined && installable && bundle !== undefined
        ? unsupported('host-outdated')
        : unsupported('no-source')
    }
    try {
      if (parsed.kind === 'local') {
        const localSha = readGitHead(parsed.path)
        if (localSha === undefined) return unsupported('local-source')
        const upstream = await localUpstream(localSha)
        if (upstream === undefined) return unsupported('local-source')
        return settle(upstream, { ...current, commit: shortSha(localSha) })
      }
      const upstream = parsed.kind === 'git' ? await gitUpstream(parsed, identity.sha) : await registryUpstream(parsed, current.version)
      return settle(upstream)
    } catch (error) {
      // 403/429 是上游限流，跟「查不到来源」不是一回事，文案要分开（本机真的撞到过 0/60）。
      const limited = error?.status === 403 || error?.status === 429
      return { ...unsupported(limited ? 'rate-limited' : 'check-failed'), detail: error instanceof Error ? error.message : String(error) }
    }
  }

  /** 执行更新：交给宿主的插件管理器完成。
   *
   * 实测（真实 dsh web 宿主）：原样重装 profile 记的那条 spec 会被宿主判成 ambiguous-install——宿主用
   * 「package.json 里的依赖串变了没有」来定位这次装的是哪个包，依赖串原样不变就找不到目标。所以先装刚
   * 检查到的确切提交/版本（依赖串一定变），再把依赖串换回 profile 记录的那条会前进的线（分支/标签/默认
   * 分支），免得更新一次就把 profile 钉死在某个提交上、这一行以后永远报「已是最新」。
   *
   * 载荷契约（客户端只读这些）：`state`、`errorCode`、`errorDetail`、`commit`、`pinnedSpec`；
   * `application`/`spec`/`version` 留给宿主侧排查用。 */
  async function apply() {
    const manager = managerOf()
    if (manager === undefined || typeof manager.installBundle !== 'function') return { state: 'unsupported' }
    const checked = await status()
    if (checked.state !== 'update-available' || checked.latest === undefined) {
      // 检查本身没结论（限流 / 网络）时要说成「检查失败」，别让用户以为更新失败。
      return checked.state === 'unknown'
        ? { state: 'check-failed', ...(checked.reason === undefined ? {} : { errorCode: checked.reason }) }
        : { state: checked.state, current: checked.current }
    }
    const parsed = parseInstallSource(checked.current.source)
    // 本地路径安装要跟的是「包自己声明的仓库的默认分支」，别的一律跟 profile 记的那条 spec。
    const target = parsed !== undefined && parsed.kind === 'local' ? { ...checked.latest, repo: self.repository } : checked.latest
    const plan = updateSpecs(parsed, target)
    // 防御性：state 说「有新版」时 target 里一定有可装的标识，正常走不到这里。
    if (plan === undefined) return { state: 'failed', errorCode: 'unsupported-source' }
    const requestId = `${self.name}-update-${Date.now().toString(36)}`

    /** 装一个 spec 并把宿主的应用结果如实转成载荷。 */
    const runInstall = async (spec, step) => {
      const bundle = await selfBundle()
      // 读不到当前启停状态就不动手：宿主对「没传 enabled」的安装默认启用，会把用户关掉的宠物打开。
      if (bundle === undefined || typeof bundle.enabled !== 'boolean') {
        return { state: 'failed', errorCode: 'unknown-enabled-state' }
      }
      const result = await manager.installBundle(spec, { enabled: bundle.enabled, requestId: `${requestId}-${String(step)}` })
      const application = typeof result?.application === 'string' ? result.application : undefined
      const failure = result?.error
      return {
        state: applicationState(application),
        ...(application === undefined ? {} : { application }),
        ...(typeof failure?.code === 'string' ? { errorCode: failure.code } : {}),
        ...(typeof failure?.diagnostic === 'string' ? { errorDetail: failure.diagnostic } : {}),
        spec,
        version: result?.version ?? checked.latest.version,
        ...(checked.latest.commit === undefined ? {} : { commit: checked.latest.commit }),
      }
    }

    let done
    for (const [index, spec] of plan.specs.entries()) {
      let outcome
      try {
        outcome = await runInstall(spec, index + 1)
      } catch (error) {
        // 宿主真抛（锁超时 / dispose）：第一步装完之后 profile 已经停在钉死的提交上，跟
        // 返回 failed 是同一种后果——同样报 tracking-not-restored 并把钉住的 spec 交界面说清楚。
        outcome = { state: 'failed', errorDetail: error instanceof Error ? error.message : String(error) }
      }
      if (outcome.state === 'failed') {
        if (index === 0) return outcome
        // 第二步失败时 profile 停在第一步钉死的那条 spec 上：这不是「什么都没发生」——把宿主的错误码
        // 并进诊断里，并把当前钉住的 spec 交给界面说清楚。
        const hostCode = outcome.errorCode
        return {
          ...outcome,
          errorCode: 'tracking-not-restored',
          ...(hostCode === undefined ? {} : { errorDetail: [hostCode, outcome.errorDetail].filter((part) => typeof part === 'string' && part !== '').join(' · ') }),
          pinnedSpec: plan.specs[0],
        }
      }
      done = outcome
    }
    return done ?? { state: 'failed', errorCode: 'unsupported-source' }
  }

  return { status, apply }
}
