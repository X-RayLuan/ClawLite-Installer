#!/usr/bin/env node

/**
 * Release script (macOS/Windows)
 *
 * Usage:
 *   npm run release            # patch (1.3.4 → 1.3.5)
 *   npm run release -- minor   # minor (1.3.4 → 1.4.0)
 *   npm run release -- major   # major (1.3.4 → 2.0.0)
 */

import { execSync } from 'child_process'
import { existsSync, readFileSync, statSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const distDir = join(rootDir, 'dist')
const packageJsonPath = join(rootDir, 'package.json')
const packageLockPath = join(rootDir, 'package-lock.json')
const run = (cmd) => execSync(cmd, { cwd: rootDir, stdio: 'inherit' })
const runSilent = (cmd) => execSync(cmd, { cwd: rootDir, encoding: 'utf8' }).trim()
const shellEscape = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))

const bump = process.argv[2] || 'patch'
if (!['patch', 'minor', 'major'].includes(bump)) {
  console.error(`Invalid version type: ${bump} (patch | minor | major)`)
  process.exit(1)
}

const releaseAssets = [
  {
    path: join(distDir, 'clawlite.dmg'),
    label: 'macOS DMG',
    buildCommand: 'npm run build:mac-local',
    platforms: ['darwin']
  },
  {
    path: join(distDir, 'clawlite-setup.exe'),
    label: 'Windows installer',
    buildCommand: 'npm run build:win-local',
    platforms: ['win32']
  }
]

const requiredAssets = releaseAssets.filter(({ platforms }) => platforms.includes(process.platform))
if (requiredAssets.length === 0) {
  console.error(`Unsupported platform: ${process.platform}`)
  process.exit(1)
}

const readPackageVersions = () => {
  const pkg = readJson(packageJsonPath)
  const lock = readJson(packageLockPath)

  return {
    packageVersion: pkg.version,
    packageLockVersion: lock.version ?? lock.packages?.['']?.version ?? null
  }
}

const assertVersionConsistency = () => {
  const { packageVersion, packageLockVersion } = readPackageVersions()

  if (!packageVersion || !packageLockVersion || packageVersion !== packageLockVersion) {
    console.error('Version mismatch. Please sync package.json and package-lock.json first.')
    console.error(`  package.json: ${packageVersion ?? 'missing'}`)
    console.error(`  package-lock.json: ${packageLockVersion ?? 'missing'}`)
    process.exit(1)
  }

  return packageVersion
}

const buildFreshAsset = ({ path, label, buildCommand }) => {
  const buildStartedAt = Date.now()
  run(buildCommand)

  if (!existsSync(path)) {
    console.error(`${label} build artifact not found: ${path}`)
    process.exit(1)
  }

  if (statSync(path).mtimeMs < buildStartedAt) {
    console.error(`${label} artifact was not freshly built in this run: ${path}`)
    process.exit(1)
  }

  return path
}

const extractPlistValue = (plist, key) => {
  const match = plist.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]+)</string>`))
  return match?.[1] ?? null
}

const assertMacBundleVersion = (version) => {
  if (process.platform !== 'darwin') return

  const appPlistPath = join(distDir, 'mac-universal', 'ClawLite.app', 'Contents', 'Info.plist')
  if (!existsSync(appPlistPath)) {
    console.error(`macOS app bundle not found: ${appPlistPath}`)
    process.exit(1)
  }

  const plist = readFileSync(appPlistPath, 'utf8')
  const shortVersion = extractPlistValue(plist, 'CFBundleShortVersionString')
  const bundleVersion = extractPlistValue(plist, 'CFBundleVersion')

  if (shortVersion !== version || bundleVersion !== version) {
    console.error('Built macOS app bundle version does not match package.json.')
    console.error(`  package.json: ${version}`)
    console.error(`  CFBundleShortVersionString: ${shortVersion ?? 'missing'}`)
    console.error(`  CFBundleVersion: ${bundleVersion ?? 'missing'}`)
    process.exit(1)
  }
}

const assertMacDmgVersion = (version) => {
  if (process.platform !== 'darwin') return

  const dmgPath = join(distDir, 'clawlite.dmg')
  run(`node scripts/verify-mac-artifact.mjs ${shellEscape(version)} ${shellEscape(dmgPath)}`)
}

// 1. Verify working tree is clean
const status = runSilent('git status --porcelain')
if (status) {
  console.error('Uncommitted changes detected. Please commit first.')
  process.exit(1)
}

// 2. Verify current version file consistency
assertVersionConsistency()

// 3. Version bump
run(`npm version ${bump} --no-git-tag-version`)
const version = assertVersionConsistency()
const tag = `v${version}`
console.log(`\n>> Version: ${tag}`)

// 4. Build installer for current OS + verify version
const uploaded = requiredAssets.map(buildFreshAsset)
assertMacBundleVersion(version)
assertMacDmgVersion(version)

// 5. Commit & push
run('git add package.json package-lock.json')
run(`git commit -m "chore(release): bump version to ${tag}"`)
run('git push origin main')
console.log('>> Commit & push complete')

// 6. Create GitHub release
run(`gh release create ${tag} --title "${tag}" --notes "Release ${tag}"`)

// 7. Upload only freshly built installer artifacts
const missing = releaseAssets
  .filter(({ path }) => !existsSync(path))
  .map(({ path }) => path)

for (const assetPath of uploaded) {
  run(`gh release upload ${tag} ${shellEscape(assetPath)} --clobber`)
}

console.log(`\nRelease ${tag} complete`)
if (uploaded.length > 0) {
  console.log('Uploaded files:')
  for (const asset of uploaded) console.log(`  ${asset}`)
}
if (missing.length > 0) {
  console.log('Missing files (not uploaded):')
  for (const asset of missing) console.log(`  ${asset}`)
}
console.log(`Release page: https://github.com/ClawLite/ClawLite-Installer/releases/tag/${tag}`)
