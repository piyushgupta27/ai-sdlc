/**
 * Tests for the shared severity-rubric helpers (Slice 2).
 */

import { describe, expect, it } from 'vitest'
import { CHECKER_CONTRACT_VERSION, isBlockingPriority, priorityRank } from './checker.js'

describe('isBlockingPriority', () => {
  it('treats P0/P1 as blocking and P2/P3 as non-blocking (push gate §6)', () => {
    expect(isBlockingPriority('P0')).toBe(true)
    expect(isBlockingPriority('P1')).toBe(true)
    expect(isBlockingPriority('P2')).toBe(false)
    expect(isBlockingPriority('P3')).toBe(false)
  })
})

describe('priorityRank', () => {
  it('ranks most-severe first', () => {
    expect(priorityRank('P0')).toBeLessThan(priorityRank('P1'))
    expect(priorityRank('P1')).toBeLessThan(priorityRank('P2'))
    expect(priorityRank('P2')).toBeLessThan(priorityRank('P3'))
  })

  it('sorts a finding list most-severe first', () => {
    const sorted = (['P3', 'P0', 'P2', 'P1'] as const)
      .slice()
      .sort((a, b) => priorityRank(a) - priorityRank(b))
    expect(sorted).toEqual(['P0', 'P1', 'P2', 'P3'])
  })
})

describe('CHECKER_CONTRACT_VERSION', () => {
  it('is the v1 contract tag', () => {
    expect(CHECKER_CONTRACT_VERSION).toBe('checker/v1')
  })
})
