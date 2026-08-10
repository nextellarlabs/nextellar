// Simple integration test to ensure MSW intercepts network requests
describe('MSW integration', () => {
  test('fetch to mocked Horizon account is intercepted', async () => {
    const res = await fetch('https://horizon-testnet.stellar.org/accounts/test-account-123');
    const json = await res.json();
    expect(json).toBeDefined();
    expect(json.account_id || json.id).toBe('test-account-123');
  });
});
