import { clearNonces, createNonce, consumeNonce, getNonce } from '../lib/walletNonces'
import { challengeHandler, verifyHandler } from '../routes/auth.wallet'
import crypto from 'crypto'
import { clearStore } from '../lib/sessions'

beforeEach(() => {
  clearNonces()
  clearStore()
})

function sigFor(nonce: string, publicKey: string) {
  return crypto.createHash('sha256').update(nonce + publicKey).digest('hex')
}

test('challenge provides a nonce and verify creates session', async () => {
  const pk = 'GUSER1PUB'
  const ch = await challengeHandler({ publicKey: pk })
  expect(ch.status).toBe(200)
  const nonce = ch.body.nonce
  const signature = sigFor(nonce, pk)
  const v = await verifyHandler({ publicKey: pk, signature })
  expect(v.status).toBe(200)
  expect(v.body.refreshToken).toBeDefined()
})

test('nonce cannot be reused', async () => {
  const pk = 'GUSER2PUB'
  const { body } = await challengeHandler({ publicKey: pk })
  const nonce = body.nonce
  const sig = sigFor(nonce, pk)
  const first = await verifyHandler({ publicKey: pk, signature: sig })
  expect(first.status).toBe(200)
  const second = await verifyHandler({ publicKey: pk, signature: sig })
  expect(second.status).toBe(400)
})

test('expired nonce fails', async () => {
  const pk = 'GUSER3PUB'
  // create with zero ttl by calling createNonce directly
  const nonce = createNonce(pk, 1)
  // fast-forward by waiting
  await new Promise(r => setTimeout(r, 5))
  const sig = sigFor(nonce, pk)
  const res = await verifyHandler({ publicKey: pk, signature: sig })
  expect(res.status).toBe(400)
})
