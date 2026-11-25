/** @jest-environment jsdom */
import { act, renderHook, waitFor, SOROBAN_TESTNET_RPC, VALID_CONTRACT_ID } from '../helpers';
import { Address, rpc, xdr } from '@stellar/stellar-sdk';
import { useContractStorage } from '../../src/templates/default/src/hooks/useContractStorage.ts';

function ledgerResponse(value: xdr.ScVal) {
  const data = new xdr.ContractDataEntry({
    ext: new xdr.ExtensionPoint(0),
    contract: new Address(VALID_CONTRACT_ID).toScAddress(),
    key: xdr.ScVal.scvSymbol('counter'),
    durability: xdr.ContractDataDurability.persistent(),
    val: value,
  });
  return {
    entries: [{
      key: xdr.LedgerKey.contractData(new xdr.LedgerKeyContractData({
        contract: new Address(VALID_CONTRACT_ID).toScAddress(),
        key: xdr.ScVal.scvSymbol('counter'),
        durability: xdr.ContractDataDurability.persistent(),
      })),
      val: xdr.LedgerEntryData.contractData(data),
      lastModifiedLedgerSeq: 80,
      liveUntilLedgerSeq: 900,
    }],
    latestLedger: 100,
  };
}

describe('useContractStorage', () => {
  afterEach(() => jest.restoreAllMocks());

  it('fetches and decodes a persistent entry including its TTL', async () => {
    const getEntries = jest.spyOn(rpc.Server.prototype, 'getLedgerEntries')
      .mockResolvedValue(ledgerResponse(xdr.ScVal.scvU32(42)) as never);
    const { result } = renderHook(() => useContractStorage({
      contractId: VALID_CONTRACT_ID,
      key: xdr.ScVal.scvSymbol('counter'),
      sorobanRpc: SOROBAN_TESTNET_RPC,
    }));

    await waitFor(() => expect(result.current.entry?.value).toBe(42));
    expect(result.current.liveUntilLedgerSeq).toBe(900);
    expect(result.current.latestLedger).toBe(100);
    expect(getEntries).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBeNull();
  });

  it('reports an entry that is absent', async () => {
    jest.spyOn(rpc.Server.prototype, 'getLedgerEntries').mockResolvedValue({ entries: [], latestLedger: 100 } as never);
    const { result } = renderHook(() => useContractStorage({ contractId: VALID_CONTRACT_ID, key: xdr.ScVal.scvSymbol('counter'), sorobanRpc: SOROBAN_TESTNET_RPC }));
    await waitFor(() => expect(result.current.error?.message).toMatch(/no persistent storage entry/i));
    expect(result.current.entry).toBeNull();
  });

  it('surfaces RPC failures and permits retry', async () => {
    const getEntries = jest.spyOn(rpc.Server.prototype, 'getLedgerEntries')
      .mockRejectedValueOnce(new Error('RPC offline'))
      .mockResolvedValueOnce(ledgerResponse(xdr.ScVal.scvString('ok')) as never);
    const { result } = renderHook(() => useContractStorage({ contractId: VALID_CONTRACT_ID, key: xdr.ScVal.scvSymbol('counter'), sorobanRpc: SOROBAN_TESTNET_RPC }));
    await waitFor(() => expect(result.current.error?.message).toContain('RPC offline'));
    await act(async () => result.current.refresh());
    expect(result.current.value).toBe('ok');
    expect(result.current.error).toBeNull();
    expect(getEntries).toHaveBeenCalledTimes(2);
  });
});
