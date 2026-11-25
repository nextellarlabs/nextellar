/**
 * @jest-environment jsdom
 */
import { act, renderHook } from '@testing-library/react';
import { useSep12Kyc } from '../../src/templates/default/src/hooks/useSep12Kyc';

const SERVER = 'https://anchor.example.org/sep12';
const ACCOUNT = 'GAKAESXZZO3PJPEI5FNXGFOIANZJU7NAMNU753SGVSY7GF2KK55DALUQ';

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe('useSep12Kyc', () => {
  let fetchImpl: jest.Mock;

  beforeEach(() => {
    fetchImpl = jest.fn();
  });

  const setup = (authToken = 'jwt') =>
    renderHook(() => useSep12Kyc({ kycServer: SERVER, authToken, fetchImpl }));

  it('loads status and requested fields with a SEP-10 token', async () => {
    fetchImpl.mockResolvedValue(
      response({
        id: 'customer-1',
        status: 'NEEDS_INFO',
        fields: { first_name: { description: 'Legal first name' } },
      }),
    );
    const { result } = setup();

    await act(async () => {
      await result.current.getCustomer({ account: ACCOUNT, type: 'sep6' });
    });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`${SERVER}/customer?account=${ACCOUNT}&type=sep6`);
    expect(init.method).toBe('GET');
    expect(init.headers.Authorization).toBe('Bearer jwt');
    expect(result.current.status).toBe('NEEDS_INFO');
    expect(result.current.fields.first_name.description).toBe('Legal first name');
    expect(result.current.loading).toBe(false);
  });

  it('submits fields and binary files using SEP-12 multipart PUT /customer', async () => {
    fetchImpl.mockResolvedValue(response({ id: 'customer-1' }, 202));
    const { result } = setup();

    await act(async () => {
      await result.current.submitCustomerInfo({
        account: ACCOUNT,
        fields: { first_name: 'Ada' },
        files: {
          proof_of_address: {
            name: 'address.pdf',
            contentType: 'application/pdf',
            data: 'cGRm',
          },
        },
      });
    });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`${SERVER}/customer`);
    expect(init.method).toBe('PUT');
    expect(init.headers.Authorization).toBe('Bearer jwt');
    expect(init.headers['Content-Type']).toBeUndefined();
    expect(init.body).toBeInstanceOf(FormData);
    expect(init.body.get('account')).toBe(ACCOUNT);
    expect(init.body.get('first_name')).toBe('Ada');
    const uploadedFile = init.body.get('proof_of_address') as File;
    expect(uploadedFile.name).toBe('address.pdf');
    expect(uploadedFile.type).toBe('application/pdf');
    expect(uploadedFile.size).toBe(3);
    expect(result.current.customer?.id).toBe('customer-1');
    expect(result.current.status).toBeUndefined();
  });

  it.each(['NEEDS_INFO', 'PROCESSING', 'ACCEPTED', 'REJECTED'] as const)(
    'surfaces the %s status',
    async (status) => {
      fetchImpl.mockResolvedValue(response({ status }));
      const { result } = setup();

      await act(async () => {
        await result.current.getCustomer({ account: ACCOUNT });
      });

      expect(result.current.status).toBe(status);
    },
  );

  it('requires a SEP-10 JWT and records the error without making a request', async () => {
    const { result } = setup('');
    let thrown: unknown;

    await act(async () => {
      thrown = await result.current.getCustomer({ account: ACCOUNT }).catch((err) => err);
    });

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain('SEP-10 JWT is required');
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.current.error?.message).toContain('SEP-10 JWT is required');
    expect(result.current.loading).toBe(false);
  });

  it('surfaces anchor errors and rethrows them', async () => {
    fetchImpl.mockResolvedValue(response({ error: 'invalid account' }, 400));
    const { result } = setup();
    let thrown: unknown;

    await act(async () => {
      thrown = await result.current.getCustomer({ account: ACCOUNT }).catch((err) => err);
    });

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain('invalid account');
    expect(result.current.error?.message).toContain('invalid account');
    expect(result.current.loading).toBe(false);
  });

  it('uses the SEP-10 JWT identity when no account or customer id is passed', async () => {
    fetchImpl.mockResolvedValue(response({ status: 'NEEDS_INFO', fields: {} }));
    const { result } = setup();

    await act(async () => {
      await result.current.getCustomer({});
    });

    expect(fetchImpl.mock.calls[0][0]).toBe(`${SERVER}/customer`);
    expect(result.current.status).toBe('NEEDS_INFO');
  });

  it('surfaces fetch failures and rejects malformed status responses', async () => {
    fetchImpl.mockRejectedValue(new Error('offline'));
    const { result } = setup();
    let networkError: unknown;
    let responseError: unknown;

    await act(async () => {
      networkError = await result.current
        .getCustomer({ account: ACCOUNT })
        .catch((err) => err);
    });
    fetchImpl.mockResolvedValue(response({ id: 'customer-1' }));
    await act(async () => {
      responseError = await result.current
        .getCustomer({ account: ACCOUNT })
        .catch((err) => err);
    });

    expect((networkError as Error).message).toContain('offline');
    expect((responseError as Error).message).toContain('missing customer status');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.current.error?.message).toContain('missing customer status');
  });
});
