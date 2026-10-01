/**
 * Synthetic HQS letter text fixtures matching the two example letters used in product tests.
 * Doc 1: 1 emergency (gas range) + 11 standard; HAP abatement; no reinspection date.
 * Doc 2: 13 standard, 0 emergency, no Emergency section; reinspection 9/28/2026.
 */

export const HQS_FIXTURE_DOC1_TEXT = `
HOUSING AUTHORITY — Housing Quality Standards (HQS) Fail Letter

Owner ID: OWN-44821
Tenant ID: TEN-90210
Inspection ID: INSP-77102
Letter Date: 08/15/2026
Inspection Date: 08/12/2026

This unit failed HQS inspection. Because this is a third failure following two prior fails,
Housing Assistance Payments (HAP) abatement of payments will begin. HAP abatement is in effect.

Emergency Items (24-Hour):
Owner | Kitchen | Gas Range/Oven | Gas range not lighting; strong odor — repair immediately

Standard Items (30-Day):
Owner | Living Room | Smoke Detector | Missing battery
Owner | Hallway | Smoke Detectors | Detector chirping
Owner | Bedroom 1 | Windows | Broken latch
Owner | Bedroom 2 | Windows | Will not stay open
Owner | Bathroom | Toilet | Loose at base
Owner | Bathroom | Sink | Slow drain
Owner | Kitchen | Refrigerator | Door seal torn
Owner | Exterior | Exterior Doors | Weatherstrip missing
Owner | Exterior | Handrails | Loose post
Owner | Bedroom 1 | Electrical Outlets | Cover plate cracked
Owner | Living Room | Floors | Trip hazard at threshold
`

export const HQS_FIXTURE_DOC2_TEXT = `
Housing Authority Compliance Notice — HQS Fail Items

Owner ID: OWN-44821
Tenant ID: TEN-90210
Inspection ID: INSP-88044
Letter Date: 09/01/2026
Inspection Date: 08/29/2026
Re-inspection Date: 09/28/2026
Re-inspection fee: $75.00

The unit failed the following standard items. A re-inspection is scheduled.

Fail Items:
Owner | Kitchen | Range/Oven | Grease buildup on burners
Owner | Kitchen | Sink | Faucet drips
Owner | Bathroom | Bathtub/Shower | Caulk failing
Owner | Bathroom | Toilet | Seat loose
Owner | Living Room | Windows | Screen torn
Owner | Bedroom 1 | Windows | Cracked pane
Owner | Bedroom 2 | Doors | Does not latch
Owner | Hallway | Lighting | Fixture loose
Owner | Exterior | Porch | Board soft
Owner | Exterior | Gutters | Detached section
Owner | Site/Grounds | Site/Grounds | Debris pile
Owner | Bedroom 1 | Walls | Hole near outlet
Owner | Living Room | Ceiling | Water stain
`

/** Photo OCR path should produce the same structured extract as PDF text. */
export const HQS_FIXTURE_PHOTO_OCR_DOC2 = HQS_FIXTURE_DOC2_TEXT
