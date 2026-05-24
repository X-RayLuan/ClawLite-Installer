#!/usr/bin/env node

import { execFileSync } from 'child_process'
import { existsSync } from 'fs'
import { basename, join } from 'path'

const [, , expectedVersionArg, dmgPath, appPathArg] = process.argv

// Resolve expected version from package.json if not provided
const resolveVersion = () => {
  try {
    const pkg = JSON.parse(require('fs').readFileSync('package.json', 'utf8'))
    return pkg.version
  } catch {
    return null
  }
}

const expectedVersion = expectedVersionArg || resolveVersion()

if (!expectedVersion || !dmgPath) {
  console.error('Usage: node scripts/verify-mac-artifact.mjs [expected-version] <dmg-path> [app-path]')
  console.error('If expected-version is omitted, reads from package.json version field.')
  process.exit(1)
}

if (process.platform !== 'darwin') {
  console.error('mac artifact verification must run on macOS.')
  process.exit(1)
}

const readPlistVersion = (plistPath) => {
  const output = execFileSync('plutil', ['-p', plistPath], { encoding: 'utf8' })
  const shortMatch = output.match(/"CFBundleShortVersionString" => "([^"]+)"/)
  const bundleMatch = output.match(/"CFBundleVersion" => "([^"]+)"/)

  return {
    shortVersion: shortMatch?.[1] ?? null,
    bundleVersion: bundleMatch?.[1] ?? null
  }
}

const assertVersion = (label, actual, expected) => {
  if (actual.shortVersion !== expected || actual.bundleVersion !== expected) {
    console.error(`${label} version mismatch.`)
    console.error(`  expected: ${expected}`)
    console.error(`  CFBundleShortVersionString: ${actual.shortVersion ?? 'missing'}`)
    console.error(`  CFBundleVersion: ${actual.bundleVersion ?? 'missing'}`)
    process.exit(1)
  }
}

const appPath = appPathArg ?? join(process.cwd(), 'dist', 'mac-universal', 'ClawLite.app')
const appPlistPath = join(appPath, 'Contents', 'Info.plist')

if (!existsSync(dmgPath)) {
  console.error(`DMG not found: ${dmgPath}`)
  process.exit(1)
}

if (!existsSync(appPlistPath)) {
  console.error(`App plist not found: ${appPlistPath}`)
  process.exit(1)
}

assertVersion('Local app bundle', readPlistVersion(appPlistPath), expectedVersion)

const volumeName = `ClawLite Verify ${process.pid}`
let device = null

try {
  const attachOutput = execFileSync(
    'hdiutil',
    ['attach', dmgPath, '-nobrowse', '-readonly', '-mountpoint', `/Volumes/${volumeName}`],
    { encoding: 'utf8' }
  )
  const deviceMatch = attachOutput.match(/^\/dev\/\S+/m)
  device = deviceMatch?.[0] ?? null

  const mountedAppPath = join('/Volumes', volumeName, 'ClawLite.app', 'Contents', 'Info.plist')
  if (!existsSync(mountedAppPath)) {
    console.error(`Mounted app plist not found in DMG: ${mountedAppPath}`)
    process.exit(1)
  }

  assertVersion(`Mounted DMG ${basename(dmgPath)}`, readPlistVersion(mountedAppPath), expectedVersion)
  console.log(`Verified mac artifact version ${expectedVersion}: ${basename(dmgPath)}`)
} finally {
  if (device) {
    execFileSync('hdiutil', ['detach', device], { stdio: 'ignore' })
  }
}
