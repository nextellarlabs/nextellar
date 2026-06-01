type NonceRecord = { nonce: string; expiresAt: number }

const nonces = new Map<string, NonceRecord>()

export function createNonce(publicKey: string, ttlMs = 60_000) {
  const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36)
  nonces.set(publicKey, { nonce, expiresAt: Date.now() + ttlMs })
  return nonce
}

export function getNonce(publicKey: string) {
  const rec = nonces.get(publicKey)
  if (!rec) return null
  if (Date.now() > rec.expiresAt) {
    nonces.delete(publicKey)
    return null
  }
  return rec.nonce
}

export function consumeNonce(publicKey: string) {
  const n = getNonce(publicKey)
  if (!n) return null
  nonces.delete(publicKey)
  return n
}

export function clearNonces() {
  nonces.clear()
}
