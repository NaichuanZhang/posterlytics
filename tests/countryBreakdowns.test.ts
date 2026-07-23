import assert from 'node:assert/strict'
import { test } from 'node:test'
import { countryBreakdownsForDisplay } from '../src/lib/countryBreakdowns.ts'

const UNAVAILABLE = 'Location unavailable'

test('country breakdowns merge ISO codes with legacy country names', () => {
  const result = countryBreakdownsForDisplay([
    { key: 'US', visits: 4 },
    { key: 'United States', visits: 6 },
    { key: 'Canada', visits: 3 },
  ], 'en-US', UNAVAILABLE)

  assert.deepEqual(result, {
    buckets: [
      { key: 'country:US', label: 'United States', visits: 10 },
      { key: 'country:CA', label: 'Canada', visits: 3 },
    ],
    unavailableVisits: 0,
  })
})

test('country breakdowns aggregate unavailable values and always sort them last', () => {
  const result = countryBreakdownsForDisplay([
    { key: 'Unknown', visits: 50 },
    { key: '', visits: 25 },
    { key: 'IN', visits: 2 },
    { key: 'CA', visits: 4 },
  ], 'en-US', UNAVAILABLE)

  assert.deepEqual(result.buckets, [
    { key: 'country:CA', label: 'Canada', visits: 4 },
    { key: 'country:IN', label: 'India', visits: 2 },
    { key: 'country:unavailable', label: UNAVAILABLE, visits: 75 },
  ])
  assert.equal(result.unavailableVisits, 75)
})

test('country breakdowns localize canonical and aliased codes', () => {
  const result = countryBreakdownsForDisplay([
    { key: 'US', visits: 2 },
    { key: 'United States', visits: 3 },
    { key: 'India', visits: 1 },
  ], 'zh-CN', '无法确定位置')

  assert.deepEqual(result.buckets, [
    { key: 'country:US', label: '美国', visits: 5 },
    { key: 'country:IN', label: '印度', visits: 1 },
  ])
})

test('country breakdowns preserve unmatched legacy names and visit totals', () => {
  const input = [
    { key: 'Atlantis', visits: 7 },
    { key: 'US', visits: 3 },
    { key: 'Unknown', visits: 11 },
  ]
  const result = countryBreakdownsForDisplay(input, 'en-US', UNAVAILABLE)

  assert.deepEqual(result.buckets, [
    { key: 'legacy:atlantis', label: 'Atlantis', visits: 7 },
    { key: 'country:US', label: 'United States', visits: 3 },
    { key: 'country:unavailable', label: UNAVAILABLE, visits: 11 },
  ])
  assert.equal(
    result.buckets.reduce((total, bucket) => total + bucket.visits, 0),
    input.reduce((total, bucket) => total + bucket.visits, 0),
  )
})
