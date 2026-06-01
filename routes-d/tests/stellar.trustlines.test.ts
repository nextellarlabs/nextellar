import { addHandler, removeHandler } from '../routes/stellar.trustlines'

test('add trustline returns envelope', async () => {
  const res = await addHandler({ userId: 'user1', asset: { code: 'USD', issuer: 'GISSUER12345' } })
  expect(res.status).toBe(200)
  expect(res.body.envelope.op).toBe('change_trust')
})

test('remove trustline returns envelope', async () => {
  const res = await removeHandler({ userId: 'user1', asset: { code: 'EUR', issuer: 'GISSUER12345' } })
  expect(res.status).toBe(200)
  expect(res.body.envelope.op).toBe('remove_trust')
})

test('reject invalid asset', async () => {
  const res = await addHandler({ userId: 'user1', asset: { code: '', issuer: 'bad' } as any })
  expect(res.status).toBe(400)
})
