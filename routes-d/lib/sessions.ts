export type DeviceMeta = {
  device: string
  os?: string
  ip?: string
}

export type SessionRecord = {
  refreshToken: string
  userId: string
  createdAt: number
  lastSeenAt: number
  deviceMeta: DeviceMeta
}

const store = new Map<string, SessionRecord>()

export function createSession(refreshToken: string, userId: string, deviceMeta: DeviceMeta) {
  const now = Date.now()
  const rec: SessionRecord = { refreshToken, userId, createdAt: now, lastSeenAt: now, deviceMeta }
  store.set(refreshToken, rec)
  return rec
}

export function listSessions(userId: string) {
  const out: SessionRecord[] = []
  for (const rec of store.values()) {
    if (rec.userId === userId) out.push({ ...rec })
  }
  return out.sort((a, b) => b.lastSeenAt - a.lastSeenAt)
}

export function getSession(refreshToken: string) {
  return store.get(refreshToken) ?? null
}

export function revokeSession(refreshToken: string) {
  return store.delete(refreshToken)
}

export function revokeAllExcept(userId: string, exceptRefreshToken?: string) {
  let count = 0
  for (const [key, rec] of store.entries()) {
    if (rec.userId === userId && key !== exceptRefreshToken) {
      store.delete(key)
      count++
    }
  }
  return count
}

export function clearStore() {
  store.clear()
}
