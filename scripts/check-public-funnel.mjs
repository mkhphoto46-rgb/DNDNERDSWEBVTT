import assert from 'node:assert/strict'
import { io } from 'socket.io-client'

const publicUrl = String(process.argv[2] ?? '').trim().replace(/\/$/, '')

if (!/^https:\/\//i.test(publicUrl)) {
  throw new Error('Pass the public HTTPS Funnel URL as the first argument.')
}

const fetchJson = async (path) => {
  const response = await fetch(`${publicUrl}${path}`)
  let body = null
  try {
    body = await response.json()
  } catch {
    body = null
  }
  return { response, body }
}

const health = await fetchJson('/api/health')
assert.equal(health.response.status, 200)
assert.equal(health.body?.ok, true)

const access = await fetchJson('/api/access-info')
assert.equal(access.response.status, 200)
assert.equal(access.body?.isLocalHost, false)
assert.equal(access.body?.remoteViaProxy, true)

const hostInfo = await fetchJson('/api/host-info')
assert.equal(hostInfo.response.status, 403)

const socket = io(publicUrl, {
  transports: ['websocket', 'polling'],
  forceNew: true,
  reconnection: false,
  timeout: 8000,
})

try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Public Socket.IO connection timed out.')),
      10000,
    )

    socket.once('connect', () => {
      clearTimeout(timer)
      resolve()
    })

    socket.once('connect_error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
  })

  const dmAttempt = await new Promise((resolve, reject) => {
    socket.timeout(5000).emit(
      'session:join',
      {
        role: 'dm',
        campaignId: 'public-funnel-security-check',
        name: 'Remote DM Probe',
      },
      (error, result) => {
        if (error) return reject(error)
        resolve(result)
      },
    )
  })

  assert.equal(dmAttempt?.ok, false)
  assert.match(
    String(dmAttempt?.error ?? ''),
    /DM access is allowed only from the host computer/i,
  )

  console.log(JSON.stringify({
    ok: true,
    publicUrl,
    checks: {
      httpsHealth: true,
      proxyDetected: true,
      localHostInfoProtected: true,
      socketIoReachable: true,
      remoteDmBlocked: true,
    },
  }, null, 2))
} finally {
  socket.disconnect()
}
