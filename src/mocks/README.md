# MSW Handlers for Stellar Horizon Endpoints

This module provides reusable Mock Service Worker (MSW) handlers for Stellar Horizon API endpoints, enabling reliable testing without live network calls.

## Overview

The handlers are organized in a modular structure:

- **`horizon-handlers.ts`**: Core reusable handlers and helper functions
- **`handlers.ts`**: Main export combining all handlers (Horizon + Soroban + other)
- **`server.ts`**: MSW server setup using the handlers

## Features

- ✅ **Modular & Reusable**: Individual handlers for accounts, payments, operations, trustlines
- ✅ **Multi-Environment Support**: Test handlers for testnet, public, and custom Horizon instances
- ✅ **Realistic Mock Data**: Comprehensive mock data matching Horizon API responses
- ✅ **Pagination Support**: Built-in pagination for payments and operations endpoints
- ✅ **Customizable**: Easy to override mock data with custom accounts, operations, and balances
- ✅ **Error Scenarios**: Support for testing 404 (unfunded accounts) and other error cases

## Usage

### Basic Usage

The handlers are automatically set up in `jest.setup.ts` and available in all tests:

```typescript
// No additional setup needed - MSW is configured globally
describe('My Hook Test', () => {
  it('should fetch account data', async () => {
    const { result } = renderHook(() => useStellarBalances(publicKey));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.balances).toHaveLength(1);
  });
});
```

### Custom Handlers in Tests

For specific test scenarios, you can override handlers:

```typescript
import { server } from '../src/mocks/server';
import { createMockAccount, createAccountHandler } from '../src/mocks/handlers';

describe('Custom Account Test', () => {
  beforeEach(() => {
    // Override with custom account data
    server.use(
      http.get('https://horizon-testnet.stellar.org/accounts/:accountId', () => {
        return HttpResponse.json(createMockAccount('GABC123...', {
          balances: [
            { asset_type: 'native', balance: '5000.0000000' }
          ]
        }));
      })
    );
  });

  afterEach(() => {
    server.resetHandlers();
  });
});
```

### Using Individual Handlers

Import specific handlers for more control:

```typescript
import { 
  createAccountHandler, 
  createPaymentsHandler, 
  createOperationsHandler 
} from '../src/mocks/horizon-handlers';

// Create handlers for different environments
const testnetHandlers = [
  createAccountHandler('testnet'),
  createPaymentsHandler('testnet'),
  createOperationsHandler('testnet'),
];

const publicHandlers = [
  createAccountHandler('public'),
  createPaymentsHandler('public'),
  createOperationsHandler('public'),
];
```

### Custom Mock Data

```typescript
import { 
  createMockAccount, 
  createMockOperationRecord,
  DEFAULT_BALANCES 
} from '../src/mocks/horizon-handlers';

// Create custom account with specific balances
const customAccount = createMockAccount('GABC123...', {
  balances: [
    {
      asset_type: 'credit_alphanum4',
      asset_code: 'USDC',
      asset_issuer: 'G...",
      balance: '1000.0000000',
      limit: '5000.0000000'
    }
  ]
});

// Create custom operation records
const customOperations = [
  createMockOperationRecord(0, 'payment', {
    amount: '100.0000000',
    from: 'G...',
    to: 'G...'
  })
];
```

## API Reference

### Handler Functions

#### `createAccountHandler(environment, customAccounts)`
Creates an MSW handler for Horizon account endpoints.

- `environment`: Horizon environment (`'testnet' | 'public' | 'custom'`)
- `customAccounts`: Optional map of account IDs to mock account data

#### `createPaymentsHandler(environment, customOperations)`
Creates an MSW handler for Horizon payments endpoints with pagination.

- `environment`: Horizon environment
- `customOperations`: Optional array of custom operation records

#### `createOperationsHandler(environment, customOperations)`
Creates an MSW handler for Horizon operations endpoints with pagination.

- `environment`: Horizon environment
- `customOperations`: Optional array of custom operation records

#### `createTrustlinesHandler(environment, customBalances)`
Creates an MSW handler for account trustlines (via account endpoint).

- `environment`: Horizon environment
- `customBalances`: Optional array of custom balance objects

#### `createHorizonHandlers(environment, config)`
Creates a complete set of Horizon handlers for a given environment.

- `environment`: Horizon environment
- `config`: Optional configuration with custom data

#### `createMultiEnvironmentHandlers(environments, config)`
Creates handlers for multiple Horizon environments simultaneously.

- `environments`: Array of environments to support
- `config`: Optional configuration

### Helper Functions

#### `createMockAccount(accountId, config)`
Creates a mock Horizon account object.

- `accountId`: Stellar public key
- `config`: Optional configuration (balances, signers, etc.)

#### `createMockOperationRecord(index, type, customFields)`
Creates a mock Horizon operation record.

- `index`: Numeric index for the operation
- `type`: Operation type (`'payment' | 'create_account' | 'path_payment' | 'manage_buy_offer'`)
- `customFields`: Optional custom fields to override defaults

#### `createPaginatedResponse(records, baseUrl, accountId, endpoint, limit, startIndex)`
Creates a paginated Horizon response structure.

### Constants

#### `HORIZON_URLS`
Map of environment names to Horizon URLs:
```typescript
{
  testnet: 'https://horizon-testnet.stellar.org',
  public: 'https://horizon.stellar.org',
  custom: 'https://horizon.example.com'
}
```

#### `DEFAULT_BALANCES`
Default mock balance array with native XLM and a sample USDC balance.

## Testing Scenarios

### Testing Unfunded Accounts

```typescript
// The handler returns 404 for account ID "UNFUNDED_ACCOUNT_ID"
it('should handle unfunded accounts gracefully', async () => {
  const { result } = renderHook(() => useStellarBalances('UNFUNDED_ACCOUNT_ID'));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.balances).toHaveLength(0);
  expect(result.current.error).toBeNull();
});
```

### Testing Pagination

```typescript
it('should handle pagination correctly', async () => {
  const { result } = renderHook(() => useTransactionHistory(publicKey, { pageSize: 10 }));
  await waitFor(() => expect(result.current.items).toHaveLength(10));
  
  await act(async () => {
    await result.current.fetchNextPage();
  });
  
  expect(result.current.items).toHaveLength(20);
});
```

### Testing Different Operation Types

```typescript
import { createMockOperationRecord } from '../src/mocks/horizon-handlers';

const paymentRecords = Array.from({ length: 5 }, (_, i) =>
  createMockOperationRecord(i, 'payment')
);

const createAccountRecords = Array.from({ length: 5 }, (_, i) =>
  createMockOperationRecord(i, 'create_account')
);
```

## Architecture

The handlers are designed to be:

1. **Composable**: Individual handlers can be combined as needed
2. **Environment-Aware**: Support for different Horizon networks
3. **Type-Safe**: Full TypeScript support with defined interfaces
4. **Extensible**: Easy to add new endpoints or customize existing ones
5. **Realistic**: Mock data closely matches actual Horizon API responses

## File Structure

```
src/mocks/
├── horizon-handlers.ts    # Core reusable handlers and helpers
├── handlers.ts            # Main export combining all handlers
├── server.ts              # MSW server setup
├── stellar-sdk-mock.ts    # SDK mocks (for specific test scenarios)
└── README.md              # This file
```

## Troubleshooting

### MSW Not Intercepting Requests

If MSW handlers aren't intercepting requests:

1. Check that `jest.setup.ts` is properly importing and starting the server
2. Ensure fetch polyfill is set up correctly (before MSW import)
3. Verify handler URL patterns match your test requests
4. Check server logs by setting `onUnhandledRequest: 'error'` during debugging

### Custom Data Not Applied

If custom mock data isn't being used:

1. Ensure you're using the correct handler function with custom data
2. Check that custom data structures match the expected interfaces
3. Verify handler ordering (more specific handlers should come first)

### Pagination Issues

If pagination isn't working correctly:

1. Check that limit and cursor parameters are being passed correctly
2. Verify the cursor parsing logic in the handler
3. Ensure the `_links.next.href` is properly formatted

## Contributing

When adding new handlers:

1. Add the handler function to `horizon-handlers.ts`
2. Export it from the module
3. Include comprehensive JSDoc comments
4. Add TypeScript interfaces for request/response types
5. Update this README with usage examples
6. Add tests for the new handler in `tests/msw.test.ts`

## Related Files

- `jest.setup.ts`: Global test setup including MSW configuration
- `jest.config.mjs`: Jest configuration including module mapping
- `tests/hooks/*.test.ts`: Hook tests using the handlers
- `tests/msw.test.ts`: Basic MSW integration tests