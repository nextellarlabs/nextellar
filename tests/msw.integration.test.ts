describe('global MSW setup', () => {
  it('intercepts Horizon account requests from shared handlers', async () => {
    const accountId = 'GTESTACCOUNT123';
    const response = await fetch(
      `https://horizon-testnet.stellar.org/accounts/${accountId}`
    );

    expect(response.ok).toBe(true);
    const data = await response.json();

    expect(data.account_id).toBe(accountId);
    expect(Array.isArray(data.balances)).toBe(true);
    expect(data.balances[0]?.asset_type).toBe('native');
  });

  it('intercepts Soroban simulateTransaction requests from shared handlers', async () => {
    const response = await fetch('https://soroban-testnet.stellar.org', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 7,
        jsonrpc: '2.0',
        method: 'simulateTransaction',
        params: {},
      }),
    });

    expect(response.ok).toBe(true);
    const data = await response.json();

    expect(data.id).toBe(7);
    expect(data.result?.latestLedger).toBe(12345);
    expect(data.result?.result?.retval).toBe('AAAAFgAAAAAAAAAAbw==');
  });
});
