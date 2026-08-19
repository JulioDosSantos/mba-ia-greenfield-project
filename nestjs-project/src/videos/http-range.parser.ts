import { RangeNotSatisfiableException } from '../common/exceptions/domain.exception';

export type HttpByteRange = {
  start: number;
  end: number;
  length: number;
  headerValue: string;
};

const SINGLE_BYTE_RANGE = /^bytes=(\d*)-(\d*)$/i;

export function parseHttpByteRange(
  value: string | undefined,
  resourceSize: number,
): HttpByteRange | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Number.isSafeInteger(resourceSize) || resourceSize <= 0) {
    throw new RangeNotSatisfiableException();
  }

  const match = SINGLE_BYTE_RANGE.exec(value.trim());
  if (!match || (!match[1] && !match[2])) {
    throw new RangeNotSatisfiableException();
  }

  const startValue = match[1] ? toSafeInteger(match[1]) : undefined;
  const endValue = match[2] ? toSafeInteger(match[2]) : undefined;
  if (startValue === null || endValue === null) {
    throw new RangeNotSatisfiableException();
  }

  if (startValue === undefined) {
    return createSuffixRange(endValue!, resourceSize);
  }

  if (startValue >= resourceSize) {
    throw new RangeNotSatisfiableException();
  }

  const end = endValue === undefined ? resourceSize - 1 : endValue;
  if (end < startValue) {
    throw new RangeNotSatisfiableException();
  }

  return createRange(startValue, Math.min(end, resourceSize - 1));
}

function createSuffixRange(
  suffixLength: number,
  resourceSize: number,
): HttpByteRange {
  if (suffixLength <= 0) {
    throw new RangeNotSatisfiableException();
  }

  const start = Math.max(resourceSize - suffixLength, 0);
  return createRange(start, resourceSize - 1);
}

function createRange(start: number, end: number): HttpByteRange {
  return {
    start,
    end,
    length: end - start + 1,
    headerValue: `bytes=${start}-${end}`,
  };
}

function toSafeInteger(value: string): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}
