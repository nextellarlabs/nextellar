import { decodeCursor, encodeCursor } from '../lib/pagination.js';

const secret = 'test-cursor-secret-value';

describe('routes-d pagination cursor helper', () => {
  it('round trips stable sort keys', () => {
    const cursor = encodeCursor(
      [
        { field: 'createdAt', direction: 'desc', value: '2026-05-30T12:00:00.000Z' },
        { field: 'id', direction: 'asc', value: 'txn_123' },
      ],
      { secret, now: new Date('2026-05-30T12:00:00.000Z') },
    );

    expect(decodeCursor(cursor, { secret })).toEqual({
      version: 1,
      issuedAt: '2026-05-30T12:00:00.000Z',
      sort: [
        { field: 'createdAt', direction: 'desc', value: '2026-05-30T12:00:00.000Z' },
        { field: 'id', direction: 'asc', value: 'txn_123' },
      ],
    });
  });

  it('rejects tampered cursors', () => {
    const cursor = encodeCursor([{ field: 'id', direction: 'asc', value: 'txn_123' }], { secret });
    const tampered = `${cursor.slice(0, -1)}${cursor.endsWith('a') ? 'b' : 'a'}`;

    expect(() => decodeCursor(tampered, { secret })).toThrow('Invalid cursor signature');
  });

  it('rejects unstable sort definitions', () => {
    expect(() => encodeCursor([], { secret })).toThrow('Cursor requires at least one sort key');
    expect(() =>
      encodeCursor([{ field: 'created at', direction: 'desc', value: 'now' }], { secret }),
    ).toThrow('Invalid cursor sort field');
  });
});
