/**
 * Unit tests for boundedEventBuffer.ts
 */

import { BoundedEventBuffer } from '../../lib/boundedEventBuffer.js';

describe('BoundedEventBuffer', () => {
  it('drops oldest entries when capacity is exceeded', () => {
    const buffer = new BoundedEventBuffer<number>(3);
    buffer.push(1);
    buffer.push(2);
    buffer.push(3);
    buffer.push(4);

    expect(buffer.toArray()).toEqual([2, 3, 4]);
  });

  it('rejects invalid capacity', () => {
    expect(() => new BoundedEventBuffer(0)).toThrow();
  });
});
