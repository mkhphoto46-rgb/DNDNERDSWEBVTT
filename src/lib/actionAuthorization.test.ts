import assert from 'node:assert/strict'
import test from 'node:test'

import {
  authoritativeCoreActionResource,
} from './actionAuthorization'

test('server authority fixes core action resources to Action', () => {
  for (const action of ['attack', 'dash', 'disengage', 'dodge']) {
    assert.equal(authoritativeCoreActionResource(action, undefined), 'action')
    assert.equal(authoritativeCoreActionResource(action, 'action'), 'action')
  }
})

test('server authority rejects forged Bonus Action and Reaction resource hints', () => {
  for (const forgedResource of ['bonus-action', 'reaction']) {
    assert.throws(
      () => authoritativeCoreActionResource('dash', forgedResource),
      /server-authoritative/i,
    )
    assert.throws(
      () => authoritativeCoreActionResource('dodge', forgedResource),
      /server-authoritative/i,
    )
  }
})

test('Stand Up spends movement and still rejects forged turn resources', () => {
  assert.equal(authoritativeCoreActionResource('stand-up', undefined), null)
  assert.equal(authoritativeCoreActionResource('stand-up', 'action'), null)
  assert.throws(
    () => authoritativeCoreActionResource('stand-up', 'bonus-action'),
    /server-authoritative/i,
  )
})

test('unknown core actions are rejected', () => {
  assert.throws(
    () => authoritativeCoreActionResource('teleport-for-free', 'action'),
    /unknown core action/i,
  )
})
