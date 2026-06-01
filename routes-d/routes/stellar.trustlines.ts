type Asset = { code: string; issuer: string }

function validateAsset(a: Asset) {
  if (!a.code || a.code.length < 1 || a.code.length > 12) return false
  if (!a.issuer || a.issuer.length < 10) return false
  // very loose issuer validation (tests will cover invalid cases)
  return true
}

export async function addHandler(req: { userId: string; asset: Asset }) {
  if (!validateAsset(req.asset)) return { status: 400, body: { error: 'invalid asset' } }
  // return a fake unsigned envelope for client to sign
  return { status: 200, body: { envelope: { op: 'change_trust', asset: req.asset, signer: req.userId } } }
}

export async function removeHandler(req: { userId: string; asset: Asset }) {
  if (!validateAsset(req.asset)) return { status: 400, body: { error: 'invalid asset' } }
  return { status: 200, body: { envelope: { op: 'remove_trust', asset: req.asset, signer: req.userId } } }
}
