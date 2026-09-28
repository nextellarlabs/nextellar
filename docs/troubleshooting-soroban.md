# Soroban RPC Troubleshooting Guide

This guide maps common Soroban RPC error messages and execution failures to their underlying causes and recommended fixes.

---

## 1. Budget & CPU Exceeded Errors

### Error Message
```text
Transaction simulation failed: HostError (Error(Budget, ExceededLimit))
```

### Cause
The transaction execution exceeded the CPU instruction or memory budget limits set by the network or transaction footprint.

### Fix / Resolution
1. **Optimize Contract Code**: Avoid heavy loops or redundant state reads/writes inside smart contract methods.
2. **Increase Budget in Simulation**: Ensure your transaction builder includes simulated CPU and memory budget estimates returned by the Soroban RPC `simulateTransaction` endpoint before submitting.
3. **Use WASM Strip Optimizer**: Strip debug names and custom sections using `wasm-strip-optimizer` to minimize WASM binary size.

---

## 2. Expired State & TTL Footprint Errors

### Error Message
```text
HostError (Error(Storage, ExceededLimit)) or Footprint Expired
```

### Cause
The contract code or instance storage entry has expired its Time-To-Live (TTL) on ledger storage.

### Fix / Resolution
1. **Extend Contract TTL**: Call `extend_contract_code_ttl` or `extend_contract_instance_ttl` via the Stellar SDK.
2. **Restore Expired Entry**: Submit a `RestoreFootprint` transaction with the required keys prior to invoking the contract method.

---

## 3. Rate Limiting & HTTP 429

### Error Message
```text
HTTP 429: Too Many Requests / Rate limit exceeded
```

### Cause
Public Soroban RPC nodes (`soroban-testnet.stellar.org`) enforce strict IP rate limits per minute.

### Fix / Resolution
1. **Use Private RPC Provider**: Switch `NEXT_PUBLIC_SOROBAN_RPC_URL` to a dedicated RPC endpoint (e.g. QuickNode, Blockdaemon, Validation Cloud).
2. **Implement Retry Backoff**: Use exponential backoff and jitter for RPC query hooks (`useSorobanRead`, `useSorobanContract`).

---

## 4. Unfunded Account / 404 Not Found

### Error Message
```text
Resource not found (404) / Account unfunded
```

### Cause
The target wallet address has not been funded with native XLM on testnet or mainnet.

### Fix / Resolution
- On Testnet: Request funds via Friendbot (`https://friendbot.stellar.org/?addr=<your-address>`).
- On Mainnet: Transfer a minimum balance of XLM (at least 1 XLM for base reserve + trustlines).

---

## 5. Contract Not Found / Invalid Address

### Error Message
```text
Error(Value, InvalidInput) / ContractNotExists
```

### Cause
The contract ID / C... address does not exist on the current network passphrase.

### Fix / Resolution
- Verify `NEXT_PUBLIC_STELLAR_NETWORK` matches the network where the contract was deployed.
- Confirm contract deployment transaction completed successfully on ledger.
