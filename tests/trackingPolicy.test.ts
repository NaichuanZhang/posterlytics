import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getPosterSize, hasPosterQrBand } from '../src/lib/posterSize.ts'
import { isCampaignTrackingActive } from '../src/lib/trackingPolicy.ts'
import type { UseCaseId } from '../src/lib/useCases.ts'

const cases: Array<{
  name: string
  use_case: UseCaseId
  destination_url: string | null
  poster_format: 'rednote_cover_3x4' | 'rednote_3x4'
  expected: boolean
}> = [
  {
    name: 'website remains active on a bandless format',
    use_case: 'website_product',
    destination_url: 'https://example.com/website',
    poster_format: 'rednote_cover_3x4',
    expected: true,
  },
  {
    name: 'Amazon remains active on a bandless format',
    use_case: 'amazon_listing',
    destination_url: 'https://amazon.com/dp/B0FIXTURE',
    poster_format: 'rednote_cover_3x4',
    expected: true,
  },
  {
    name: 'event remains active on a bandless format',
    use_case: 'event',
    destination_url: 'https://lu.ma/fixture',
    poster_format: 'rednote_cover_3x4',
    expected: true,
  },
  {
    name: 'social cover defaults inactive without a destination',
    use_case: 'social_cover',
    destination_url: null,
    poster_format: 'rednote_cover_3x4',
    expected: false,
  },
  {
    name: 'social cover QR mode is active with a destination',
    use_case: 'social_cover',
    destination_url: 'https://example.com/social',
    poster_format: 'rednote_3x4',
    expected: true,
  },
  {
    name: 'social cover rejects a whitespace-only destination',
    use_case: 'social_cover',
    destination_url: '   ',
    poster_format: 'rednote_3x4',
    expected: false,
  },
  {
    name: 'RedNote stays inactive even with a destination',
    use_case: 'rednote_post',
    destination_url: 'https://example.com/rednote',
    poster_format: 'rednote_cover_3x4',
    expected: false,
  },
]

for (const row of cases) {
  test(row.name, () => {
    if (row.poster_format === 'rednote_cover_3x4') {
      assert.equal(hasPosterQrBand(getPosterSize(row.poster_format)), false)
    }
    assert.equal(isCampaignTrackingActive(row), row.expected)
  })
}
