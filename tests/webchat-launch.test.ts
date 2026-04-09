import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildWebChatUrl,
  describeWebChatLaunch,
  resolveLaunchToken
} from '../src/renderer/src/steps/webchat-launch.ts'

test('resolveLaunchToken prefers the latest config token over stale state', () => {
  assert.deepEqual(resolveLaunchToken({ stateToken: 'stale-token', configToken: 'fresh-token' }), {
    token: 'fresh-token',
    source: 'config'
  })
})

test('resolveLaunchToken keeps the current state token when config is unchanged', () => {
  assert.deepEqual(resolveLaunchToken({ stateToken: 'same-token', configToken: 'same-token' }), {
    token: 'same-token',
    source: 'state'
  })
})

test('resolveLaunchToken reports missing when no token is available', () => {
  assert.deepEqual(resolveLaunchToken({ stateToken: null, configToken: null }), {
    token: null,
    source: 'missing'
  })
})

test('describeWebChatLaunch redacts the token and reports hash mode', () => {
  assert.deepEqual(describeWebChatLaunch('http://127.0.0.1:18789/#token=secret-token'), {
    mode: 'hash',
    safeUrl: 'http://127.0.0.1:18789/#token=%3Credacted%3E'
  })
})

test('describeWebChatLaunch reports query mode when token is in the query string', () => {
  assert.deepEqual(describeWebChatLaunch('http://127.0.0.1:18789/?token=secret-token'), {
    mode: 'query',
    safeUrl: 'http://127.0.0.1:18789/?token=%3Credacted%3E'
  })
})

test('buildWebChatUrl uses hash token auth', () => {
  assert.equal(buildWebChatUrl('fresh token'), 'http://127.0.0.1:18789/#token=fresh%20token')
})
