import { RangeNotSatisfiableException } from '../common/exceptions/domain.exception';
import { parseHttpByteRange } from './http-range.parser';

describe('parseHttpByteRange', () => {
  it('returns undefined when the Range header is absent', () => {
    expect(parseHttpByteRange(undefined, 100)).toBeUndefined();
  });

  it('normalizes closed and open-ended ranges against the resource size', () => {
    expect(parseHttpByteRange('bytes=10-999', 100)).toEqual({
      start: 10,
      end: 99,
      length: 90,
      headerValue: 'bytes=10-99',
    });
    expect(parseHttpByteRange('bytes=90-', 100)).toEqual({
      start: 90,
      end: 99,
      length: 10,
      headerValue: 'bytes=90-99',
    });
  });

  it('normalizes a suffix range against the resource size', () => {
    expect(parseHttpByteRange('bytes=-20', 100)).toEqual({
      start: 80,
      end: 99,
      length: 20,
      headerValue: 'bytes=80-99',
    });
    expect(parseHttpByteRange('bytes=-999', 100)).toEqual({
      start: 0,
      end: 99,
      length: 100,
      headerValue: 'bytes=0-99',
    });
  });

  it.each([
    'bytes=100-100',
    'bytes=20-10',
    'bytes=-0',
    'bytes=0-1,2-3',
    'items=0-1',
    'bytes=-',
  ])('rejects an invalid or unsatisfiable range: %s', (value) => {
    expect(() => parseHttpByteRange(value, 100)).toThrow(
      RangeNotSatisfiableException,
    );
    expect(() => parseHttpByteRange(value, 100)).toThrow(
      expect.objectContaining({ errorCode: 'RANGE_NOT_SATISFIABLE' }),
    );
  });
});
