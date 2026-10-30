import { describe, expect, it } from 'vitest'
import { accountHolderFirstName, setupPortfolioHeading } from '@/lib/setupPortfolioHeading'

describe('setup portfolio heading', () => {
  it('uses the account holder’s first name', () => {
    expect(accountHolderFirstName('  jordan   lee ')).toBe('Jordan')
    expect(setupPortfolioHeading(0, 'Jordan Lee')).toBe('Let’s get your portfolio ready, Jordan')
    expect(setupPortfolioHeading(29, 'Jordan Lee')).toBe('You’re building momentum, Jordan')
    expect(setupPortfolioHeading(30, 'Jordan Lee')).toBe('Your portfolio is taking shape, Jordan')
    expect(setupPortfolioHeading(84, 'Jordan Lee')).toBe('Strong progress, Jordan')
    expect(setupPortfolioHeading(85, 'Jordan Lee')).toBe('You’re almost there, Jordan')
    expect(setupPortfolioHeading(100, 'Jordan Lee')).toBe('Your portfolio is ready, Jordan')
  })

  it('drops the name when it is missing', () => {
    expect(accountHolderFirstName(null)).toBeNull()
    expect(accountHolderFirstName(undefined)).toBeNull()
    expect(setupPortfolioHeading(0, null)).toBe('Let’s get your portfolio ready')
    expect(setupPortfolioHeading(45, undefined)).toBe('Your portfolio is taking shape')
    expect(setupPortfolioHeading(70, undefined)).toBe('You’re making strong progress')
  })

  it('drops a blank name and never shows an email or undefined', () => {
    expect(accountHolderFirstName('   ')).toBeNull()
    expect(accountHolderFirstName('undefined')).toBeNull()
    expect(accountHolderFirstName('osi@ulohome.io')).toBeNull()
    expect(setupPortfolioHeading(12, '   ')).toBe('You’re building momentum')
    expect(setupPortfolioHeading(100, 'undefined')).toBe('Your portfolio is ready')
    expect(setupPortfolioHeading(99, 'osi@ulohome.io')).toBe('You’re almost there')
  })

  it('keeps an unusually long first name so the heading can wrap', () => {
    const longName = 'Alexandriavonhohenzollern'
    expect(accountHolderFirstName(`  ${longName.toUpperCase()}  Properties `)).toBe(longName)
    expect(setupPortfolioHeading(60, longName)).toBe(`Strong progress, ${longName}`)
  })
})