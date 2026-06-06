import { listSessions, revokeSession, getSession } from '../lib/sessions'

export async function listHandler(req: { userId: string }) {
  const sessions = listSessions(req.userId)
  return { status: 200, body: { sessions } }
}

export async function revokeHandler(req: { userId: string; refreshTokenToRevoke: string; currentRefreshToken?: string }) {
  const { userId, refreshTokenToRevoke, currentRefreshToken } = req
  if (refreshTokenToRevoke === currentRefreshToken) {
    return { status: 400, body: { error: 'cannot revoke current session' } }
  }
  const target = getSession(refreshTokenToRevoke)
  if (!target || target.userId !== userId) {
    return { status: 404, body: { error: 'session not found' } }
  }
  revokeSession(refreshTokenToRevoke)
  return { status: 200, body: { revoked: true } }
}
