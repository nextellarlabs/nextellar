import { clearStore, createSession } from '../lib/sessions'
import { listHandler, revokeHandler } from '../routes/auth.sessions'

beforeEach(() => clearStore())

test('list sessions returns created sessions', async () => {
  createSession('rt1', 'user1', { device: 'phone' })
  createSession('rt2', 'user1', { device: 'laptop' })
  const res = await listHandler({ userId: 'user1' })
  expect(res.status).toBe(200)
  expect(res.body.sessions).toHaveLength(2)
})

test('cannot revoke current session', async () => {
  createSession('rt1', 'user1', { device: 'phone' })
  const res = await revokeHandler({ userId: 'user1', refreshTokenToRevoke: 'rt1', currentRefreshToken: 'rt1' })
  expect(res.status).toBe(400)
})

test('revoke other session succeeds', async () => {
  createSession('rt1', 'user1', { device: 'phone' })
  createSession('rt2', 'user1', { device: 'laptop' })
  const res = await revokeHandler({ userId: 'user1', refreshTokenToRevoke: 'rt2', currentRefreshToken: 'rt1' })
  expect(res.status).toBe(200)
  const list = await listHandler({ userId: 'user1' })
  expect(list.body.sessions.map((s: any) => s.refreshToken)).toEqual(['rt1'])
})
