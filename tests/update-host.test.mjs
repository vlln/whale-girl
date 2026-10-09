// 更新宿主侧实现的单测（node:test，零依赖）。归属：lib/src/update-host.mjs 的行为改动跑本文件。
// 这里用真实临时目录 + 注入的假包管理器/假网络，覆盖 .git 布局解析、当前身份读取、上游三态与两步安装；
// 端点层（跨源、405、载荷）由 tests/update-route.test.mjs 覆盖。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createUpdateHost, readGitHead } from '../lib/src/update-host.mjs'

const SELF = { name: 'whale-girl', version: '0.1.0', repository: { owner: 'vlln', repo: 'whale-girl' } }
const LOCAL_SHA = 'a1'.repeat(20)
const UPSTREAM_SHA = 'b2'.repeat(20)

const home = mkdtempSync(join(tmpdir(), 'whale-host-'))

/** 建一个 profile 目录：锁文件记已安装的提交（git）或版本（registry）。 */
function makeProfile(lockYaml) {
  const dir = mkdtempSync(join(home, 'profile-'))
  writeFileSync(join(dir, 'pnpm-lock.yaml'), lockYaml)
  return dir
}

const gitLock = (sha) => ['packages:', `  whale-girl@https://codeload.github.com/vlln/whale-girl/tar.gz/${sha}:`, '    resolution: {gitHosted: true}'].join('\n')
const registryLock = (version) => ['packages:', `  whale-girl@${version}:`, '    resolution: {integrity: sha512-x}'].join('\n')

/** 建一个检出目录：`worktree: true` 时用 `.git` 文件 + commondir（worktree 布局）。 */
function makeCheckout({ sha = LOCAL_SHA, worktree = false, packed = false, detached = false } = {}) {
  const dir = mkdtempSync(join(home, 'checkout-'))
  const ref = packed ? '' : null
  if (!worktree) {
    mkdirSync(join(dir, '.git', 'refs', 'heads'), { recursive: true })
    writeFileSync(join(dir, '.git', 'HEAD'), detached ? `${sha}\n` : 'ref: refs/heads/main\n')
    if (!detached) {
      if (packed) writeFileSync(join(dir, '.git', 'packed-refs'), `# pack-refs with: peeled fully-peeled sorted\n${sha} refs/heads/main\n`)
      else writeFileSync(join(dir, '.git', 'refs', 'heads', 'main'), `${sha}\n`)
    }
    return dir
  }
  const common = mkdtempSync(join(home, 'common-'))
  mkdirSync(join(common, '.git', 'worktrees', 'wt1'), { recursive: true })
  mkdirSync(join(common, '.git', 'refs', 'heads'), { recursive: true })
  writeFileSync(join(common, '.git', 'worktrees', 'wt1', 'HEAD'), 'ref: refs/heads/main\n')
  writeFileSync(join(common, '.git', 'worktrees', 'wt1', 'commondir'), '../..\n')
  if (packed) writeFileSync(join(common, '.git', 'packed-refs'), `${sha} refs/heads/main\n`)
  else writeFileSync(join(common, '.git', 'refs', 'heads', 'main'), `${sha}\n`)
  writeFileSync(join(dir, '.git'), `gitdir: ${join(common, '.git', 'worktrees', 'wt1')}\n`)
  void ref
  return dir
}

const managerOf = (source, { enabled = true, installs = [], version } = {}) => () => ({
  listBundles: async () => [{ name: 'whale-girl', source, ...(version === undefined ? {} : { version }), enabled, installed: true }],
  installBundle: async (spec, options) => { installs.push({ spec, options }); return { application: 'restart-required', changed: true } },
})
/** 假网络：只认 GitHub/npm 的那几个 URL，按 payload 表回答；值是 Error 时抛出（模拟 403 等）。 */
const fakeFetch = (routes) => async (url) => {
  for (const [suffix, payload] of Object.entries(routes)) {
    if (url.endsWith(suffix)) {
      if (payload instanceof Error) throw payload
      return payload
    }
  }
  throw new Error(`未预期的请求 ${url}`)
}
const httpError = (status) => Object.assign(new Error(`HTTP ${status}`), { status })

test('readGitHead：普通检出目录读松散引用', () => {
  assert.equal(readGitHead(makeCheckout()), LOCAL_SHA)
})

test('readGitHead：worktree（.git 文件 + commondir）在公共目录里找引用', () => {
  assert.equal(readGitHead(makeCheckout({ worktree: true })), LOCAL_SHA)
})

test('readGitHead：只有 packed-refs 时（含 worktree 的公共目录）也能读', () => {
  assert.equal(readGitHead(makeCheckout({ packed: true })), LOCAL_SHA)
  assert.equal(readGitHead(makeCheckout({ worktree: true, packed: true })), LOCAL_SHA)
})

test('readGitHead：游离 HEAD 直接给提交', () => {
  assert.equal(readGitHead(makeCheckout({ detached: true })), LOCAL_SHA)
})

test('readGitHead：不是检出目录 / .git 指向不存在的地方 → undefined', () => {
  const plain = mkdtempSync(join(home, 'plain-'))
  assert.equal(readGitHead(plain), undefined)
  const dangling = mkdtempSync(join(home, 'dangling-'))
  writeFileSync(join(dangling, '.git'), 'gitdir: /nope/nowhere\n')
  assert.equal(readGitHead(dangling), undefined)
})

test('readGitHead：io 可注入（同一份布局逻辑能用假实现跑）', () => {
  const files = new Map([
    ['/w/.git/worktrees/wt1/HEAD', 'ref: refs/heads/main\n'],
    ['/w/.git/worktrees/wt1/commondir', '../..\n'],
    ['/w/.git/refs/heads/main', `${LOCAL_SHA}\n`],
  ])
  const normalise = (path) => {
    const parts = []
    for (const part of path.split('/')) {
      if (part === '..') parts.pop()
      else if (part !== '' && part !== '.') parts.push(part)
    }
    return `/${parts.join('/')}`
  }
  const io = {
    join: (...parts) => parts.join('/'),
    resolve: (base, rel) => normalise(rel.startsWith('/') ? rel : `${base}/${rel}`),
    statSync: () => ({ isFile: () => true }),
    readFileSync: (path) => {
      if (path === '/w/.git') return 'gitdir: /w/.git/worktrees/wt1\n'
      if (!files.has(path)) throw new Error(`ENOENT ${path}`)
      return files.get(path)
    },
  }
  assert.equal(readGitHead('/w', io), LOCAL_SHA)
})

test('status：git 安装——锁文件是当前身份，上游同提交即已是最新', async () => {
  const profileDir = makeProfile(gitLock(LOCAL_SHA))
  const host = createUpdateHost({ self: SELF, profileDir, managerOf: managerOf('github:vlln/whale-girl#main'), fetchJson: fakeFetch({ '/commits/main': { sha: LOCAL_SHA } }) })
  const status = await host.status()
  assert.equal(status.current.commit, LOCAL_SHA.slice(0, 7))
  assert.equal(status.state, 'up-to-date')
  assert.equal(status.canUpdate, false)
})

test('status：git 安装有新版时可更新；宿主没有包管理服务时 canUpdate 为 false', async () => {
  const profileDir = makeProfile(gitLock(LOCAL_SHA))
  const fetchJson = fakeFetch({ '/commits/main': { sha: UPSTREAM_SHA } })
  const withManager = await createUpdateHost({ self: SELF, profileDir, managerOf: managerOf('github:vlln/whale-girl#main'), fetchJson }).status()
  assert.equal(withManager.state, 'update-available')
  assert.equal(withManager.canUpdate, true)
  // 服务在、但没有安装能力（或插件比服务先起）：结论照给，只说「不支持应用内更新」。
  const noInstall = () => ({ listBundles: async () => [{ name: 'whale-girl', source: 'github:vlln/whale-girl#main', enabled: true }] })
  const withoutInstall = await createUpdateHost({ self: SELF, profileDir, managerOf: noInstall, fetchJson }).status()
  assert.equal(withoutInstall.state, 'update-available')
  assert.equal(withoutInstall.canUpdate, false)
})

test('status：registry 安装按版本比，摘要带版本号', async () => {
  const profileDir = makeProfile(registryLock('0.2.0'))
  const host = createUpdateHost({ self: SELF, profileDir, managerOf: managerOf('whale-girl@^0.1.0'), fetchJson: fakeFetch({ '/whale-girl': { 'dist-tags': { latest: '0.3.0' } } }) })
  const status = await host.status()
  assert.equal(status.current.version, '0.2.0')
  assert.equal(status.latest.version, '0.3.0')
  assert.equal(status.state, 'update-available')
})

test('status：本地路径安装跟包声明的仓库默认分支，当前提交取本地检出', async () => {
  const checkout = makeCheckout({ worktree: true })
  const profileDir = makeProfile('packages: {}\n')
  const host = createUpdateHost({
    self: SELF,
    profileDir,
    managerOf: managerOf(`link:${checkout}`),
    fetchJson: fakeFetch({ '/repos/vlln/whale-girl': { default_branch: 'main' }, '/commits/main': { sha: UPSTREAM_SHA } }),
  })
  const status = await host.status()
  assert.equal(status.current.commit, LOCAL_SHA.slice(0, 7))
  assert.equal(status.latest.commit, UPSTREAM_SHA.slice(0, 7))
  assert.equal(status.latest.ref, 'main', '本地安装的载荷要带跟踪的那条线，界面要靠它说清「更新会改成跟 main」')
  assert.equal(status.state, 'update-available')
})

test('status：本地路径安装认不出上游的三种情况都给 local-source', async () => {
  const profileDir = makeProfile('packages: {}\n')
  const notCheckout = mkdtempSync(join(home, 'not-a-checkout-'))
  const noRef = await createUpdateHost({ self: SELF, profileDir, managerOf: managerOf(`link:${notCheckout}`), fetchJson: fakeFetch({}) }).status()
  assert.equal(noRef.reason, 'local-source')
  const noRepo = await createUpdateHost({ self: { ...SELF, repository: undefined }, profileDir, managerOf: managerOf(`link:${makeCheckout()}`), fetchJson: fakeFetch({}) }).status()
  assert.equal(noRepo.reason, 'local-source')
  const noBranch = await createUpdateHost({ self: SELF, profileDir, managerOf: managerOf(`link:${makeCheckout()}`), fetchJson: fakeFetch({ '/repos/vlln/whale-girl': {} }) }).status()
  assert.equal(noBranch.reason, 'local-source', '拿不到默认分支名不猜 main')
})

test('status：宿主认得包但既无 source 也无 version（旧宿主）→ host-outdated；给了 version → no-source', async () => {
  const profileDir = makeProfile(gitLock(LOCAL_SHA))
  // 宿主有安装能力、也列出这个包，但记录里既没有 source 也没有 version（0.2.0-rc.2 时代的
  // BundleInfo 两个字段都没有）：无法确认宿主年代，文案引导升级宿主，不能混同于「查不到上游」。
  const outdated = await createUpdateHost({ self: SELF, profileDir, managerOf: managerOf(undefined), fetchJson: fakeFetch({}) }).status()
  assert.equal(outdated.reason, 'host-outdated')
  assert.equal(outdated.canUpdate, false)
  // 0.2.1-alpha.2 宿主给出 version、没有 source（如安装自带条目没记录来源）：宿主并不旧，
  // 是真·没有可跟的上游——按 no-source 处理，不误导用户升级宿主。
  const versionOnly = await createUpdateHost({ self: SELF, profileDir, managerOf: managerOf(undefined, { version: '0.2.0' }), fetchJson: fakeFetch({}) }).status()
  assert.equal(versionOnly.reason, 'no-source')
  assert.equal(versionOnly.current.version, '0.2.0')
  // 宿主的列表里根本没有这个包：真正的「查不到来源」。
  const notInstalled = () => ({ listBundles: async () => [] })
  const missing = await createUpdateHost({ self: SELF, profileDir, managerOf: notInstalled, fetchJson: fakeFetch({}) }).status()
  assert.equal(missing.reason, 'no-source')
  const limited = await createUpdateHost({ self: SELF, profileDir, managerOf: managerOf('github:vlln/whale-girl#main'), fetchJson: fakeFetch({ '/commits/main': httpError(403) }) }).status()
  assert.equal(limited.reason, 'rate-limited')
  assert.equal(limited.detail, 'HTTP 403')
  const broken = await createUpdateHost({ self: SELF, profileDir, managerOf: managerOf('github:vlln/whale-girl#main'), fetchJson: fakeFetch({ '/commits/main': httpError(500) }) }).status()
  assert.equal(broken.reason, 'check-failed')
})

test('status：current.version 优先取宿主 BundleInfo.version，锁文件与自身清单是回退', async () => {
  // 宿主给了 version：优先于锁文件解析与自身清单（0.2.1-alpha.2 的 BundleInfo 直接给出已装版本）。
  const hostVersion = makeProfile(registryLock('0.1.9'))
  const withHost = await createUpdateHost({ self: SELF, profileDir: hostVersion, managerOf: managerOf('whale-girl@0.1.9', { version: '0.2.0' }), fetchJson: fakeFetch({ '/whale-girl': { 'dist-tags': { latest: '0.2.0' } } }) }).status()
  assert.equal(withHost.current.version, '0.2.0')
  // 宿主没给 version：回退锁文件解析（registry 安装的锁文件版本）。
  const noHost = await createUpdateHost({ self: SELF, profileDir: hostVersion, managerOf: managerOf('whale-girl@0.1.9'), fetchJson: fakeFetch({ '/whale-girl': { 'dist-tags': { latest: '0.2.0' } } }) }).status()
  assert.equal(noHost.current.version, '0.1.9')
})

test('apply：第二步 installBundle 真抛（锁超时）→ tracking-not-restored 且带钉住的 spec', async () => {
  const profileDir = makeProfile(gitLock(LOCAL_SHA))
  const specs = []
  const manager = () => ({
    listBundles: async () => [{ name: 'whale-girl', source: 'github:vlln/whale-girl#main', enabled: true, installed: true }],
    installBundle: async (spec) => {
      specs.push(spec)
      if (specs.length === 2) throw new Error('profile package.json is locked (lock wait 120s)')
      return { application: 'restart-required', changed: true }
    },
  })
  const host = createUpdateHost({ self: SELF, profileDir, managerOf: manager, fetchJson: fakeFetch({ '/commits/main': { sha: UPSTREAM_SHA } }) })
  const result = await host.apply()
  assert.equal(result.state, 'failed')
  assert.equal(result.errorCode, 'tracking-not-restored', '第二步真抛也要告知 profile 被钉住')
  assert.equal(result.pinnedSpec, `github:vlln/whale-girl#${UPSTREAM_SHA}`, '第一步钉住的确切提交要交给界面')
  assert.match(result.errorDetail ?? '', /locked/u)
})

test('apply：没有包管理服务 → unsupported，且不安装', async () => {
  const profileDir = makeProfile(gitLock(LOCAL_SHA))
  const host = createUpdateHost({ self: SELF, profileDir, managerOf: () => undefined, fetchJson: fakeFetch({}) })
  assert.deepEqual(await host.apply(), { state: 'unsupported' })
})

test('apply：检查没结论（限流）→ check-failed，不安装', async () => {
  const profileDir = makeProfile(gitLock(LOCAL_SHA))
  const installs = []
  const host = createUpdateHost({ self: SELF, profileDir, managerOf: managerOf('github:vlln/whale-girl#main', { installs }), fetchJson: fakeFetch({ '/commits/main': httpError(429) }) })
  assert.deepEqual(await host.apply(), { state: 'check-failed', errorCode: 'rate-limited' })
  assert.deepEqual(installs, [])
})

test('apply：已是最新 → 直接回报，不安装', async () => {
  const profileDir = makeProfile(gitLock(LOCAL_SHA))
  const installs = []
  const host = createUpdateHost({ self: SELF, profileDir, managerOf: managerOf('github:vlln/whale-girl#main', { installs }), fetchJson: fakeFetch({ '/commits/main': { sha: LOCAL_SHA } }) })
  const result = await host.apply()
  assert.equal(result.state, 'up-to-date')
  assert.deepEqual(installs, [])
})

test('apply：git 安装有新版 → 两步（先确切提交再换回跟踪的线），启停状态原样带上', async () => {
  const profileDir = makeProfile(gitLock(LOCAL_SHA))
  const installs = []
  const host = createUpdateHost({ self: SELF, profileDir, managerOf: managerOf('github:vlln/whale-girl#main', { enabled: false, installs }), fetchJson: fakeFetch({ '/commits/main': { sha: UPSTREAM_SHA } }) })
  const result = await host.apply()
  assert.equal(result.state, 'restart-required')
  assert.deepEqual(installs.map((entry) => entry.spec), [`github:vlln/whale-girl#${UPSTREAM_SHA}`, 'github:vlln/whale-girl#main'])
  assert.deepEqual(installs.map((entry) => entry.options.enabled), [false, false], '关着的组合包更新后仍要关着')
  assert.notEqual(installs[0].options.requestId, installs[1].options.requestId, '两次装各自的 requestId，宿主的安装记录才分得开')
})

test('apply：本地路径安装一步换成跟上游那条线', async () => {
  const checkout = makeCheckout()
  const profileDir = makeProfile('packages: {}\n')
  const installs = []
  const host = createUpdateHost({
    self: SELF,
    profileDir,
    managerOf: managerOf(`link:${checkout}`, { installs }),
    fetchJson: fakeFetch({ '/repos/vlln/whale-girl': { default_branch: 'main' }, '/commits/main': { sha: UPSTREAM_SHA } }),
  })
  const result = await host.apply()
  assert.equal(result.state, 'restart-required')
  assert.deepEqual(installs.map((entry) => entry.spec), ['github:vlln/whale-girl#main'])
})

test('apply：读不到启停状态就不动手', async () => {
  const profileDir = makeProfile(gitLock(LOCAL_SHA))
  const installs = []
  const host = createUpdateHost({
    self: SELF,
    profileDir,
    managerOf: () => ({
      listBundles: async () => [{ name: 'whale-girl', source: 'github:vlln/whale-girl#main', installed: true }],
      installBundle: async (spec, options) => { installs.push({ spec, options }); return { application: 'restart-required' } },
    }),
    fetchJson: fakeFetch({ '/commits/main': { sha: UPSTREAM_SHA } }),
  })
  assert.deepEqual(await host.apply(), { state: 'failed', errorCode: 'unknown-enabled-state' })
  assert.deepEqual(installs, [])
})

test('apply：第二步失败时说清 profile 被钉在哪条 spec 上，并保留宿主的错误码', async () => {
  const profileDir = makeProfile(gitLock(LOCAL_SHA))
  const installs = []
  const host = createUpdateHost({
    self: SELF,
    profileDir,
    managerOf: () => ({
      listBundles: async () => [{ name: 'whale-girl', source: 'github:vlln/whale-girl#main', enabled: true, installed: true }],
      installBundle: async (spec, options) => {
        installs.push({ spec, options })
        return installs.length === 2
          ? { application: 'failed', error: { code: 'ambiguous-install', diagnostic: 'two deps changed' } }
          : { application: 'restart-required' }
      },
    }),
    fetchJson: fakeFetch({ '/commits/main': { sha: UPSTREAM_SHA } }),
  })
  const result = await host.apply()
  assert.equal(result.state, 'failed')
  assert.equal(result.errorCode, 'tracking-not-restored')
  assert.equal(result.pinnedSpec, `github:vlln/whale-girl#${UPSTREAM_SHA}`)
  assert.equal(result.errorDetail, 'ambiguous-install · two deps changed')
})

test('apply：来源认不出来 → 检查阶段就报 no-source，POST 归到「检查失败」，不安装', async () => {
  const profileDir = makeProfile(gitLock(LOCAL_SHA))
  const installs = []
  const host = createUpdateHost({ self: SELF, profileDir, managerOf: managerOf('gitlab:vlln/whale-girl', { installs }), fetchJson: fakeFetch({}) })
  assert.deepEqual(await host.apply(), { state: 'check-failed', errorCode: 'no-source' })
  assert.deepEqual(installs, [])
})
