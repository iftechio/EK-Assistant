import { describe, expect, it } from 'vitest'
import { compactKol, numericStats, percentileOf, truncate } from './helpers.js'

describe('numericStats', () => {
  it('computes median for odd/even counts', () => {
    expect(numericStats([3, 1, 2])?.median).toBe(2)
    expect(numericStats([1, 2, 3, 4])?.median).toBe(2.5)
  })
  it('ignores non-finite values and handles empty', () => {
    expect(numericStats([NaN, Infinity])).toBeNull()
    expect(numericStats([NaN, 5])?.count).toBe(1)
  })
})

describe('percentileOf', () => {
  it('returns percentile of value within sample', () => {
    expect(percentileOf([10, 20, 30, 40], 40)).toBe(100)
    expect(percentileOf([10, 20, 30, 40], 15)).toBe(25)
    expect(percentileOf([], 5)).toBeNull()
  })
})

describe('compactKol', () => {
  it('keeps only semantic fields and drops undefined', () => {
    const out = compactKol({
      id: 'k1',
      title: '博主A',
      subscribers: 12000,
      description: 'x'.repeat(500),
      irrelevantHugeField: { a: 1 },
    })
    expect(out.kolId).toBe('k1')
    expect(out.followers).toBe(12000)
    expect((out.description as string).length).toBeLessThanOrEqual(151)
    expect('irrelevantHugeField' in out).toBe(false)
    expect('email' in out).toBe(false)
  })
})

describe('truncate', () => {
  it('truncates long strings with ellipsis', () => {
    expect(truncate('abcdef', 3)).toBe('abc…')
    expect(truncate('ab', 3)).toBe('ab')
  })
})
