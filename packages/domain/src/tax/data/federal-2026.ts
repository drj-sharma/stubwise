import type { FederalTaxData } from '../types';

/**
 * Federal withholding figures for pay dated in 2026.
 *
 * Sources (read 2026-11-22):
 * - IRS Publication 15-T (2026), "2026 Percentage Method Tables for Automated
 *   Payroll Systems" and Worksheet 1A: https://www.irs.gov/publications/p15t
 * - IRS Publication 15 (2026), "Social security and Medicare taxes for 2026":
 *   https://www.irs.gov/publications/p15
 *
 * Every figure below is copied from those pages. Do not edit a number without
 * the publication open, and add a new file for each new tax year.
 * Bracket rows are [at least (dollars), tentative amount (cents), percent].
 */
export const FEDERAL_2026: FederalTaxData = {
  year: 2026,
  // Worksheet 1A, line 1g: used when the Step 2 box is NOT checked.
  standardAdjustmentCents: { married: 12_900_00, single: 8_600_00, head: 8_600_00 },
  // Worksheet 1A, line 1k: $4,300 per withholding allowance, for a Form W-4 from 2019 or earlier.
  // Those forms use the STANDARD schedules below (never Head of Household) and have no Step 2 box.
  legacyAllowanceCents: 4_300_00,
  // STANDARD Withholding Rate Schedules.
  standard: {
    married: [
      [0, 0, 0],
      [19_300, 0, 10],
      [44_100, 2_480_00, 12],
      [120_100, 11_600_00, 22],
      [230_700, 35_932_00, 24],
      [422_850, 82_048_00, 32],
      [531_750, 116_896_00, 35],
      [788_000, 206_583_50, 37],
    ],
    single: [
      [0, 0, 0],
      [7_500, 0, 10],
      [19_900, 1_240_00, 12],
      [57_900, 5_800_00, 22],
      [113_200, 17_966_00, 24],
      [209_275, 41_024_00, 32],
      [263_725, 58_448_00, 35],
      [648_100, 192_979_25, 37],
    ],
    head: [
      [0, 0, 0],
      [15_550, 0, 10],
      [33_250, 1_770_00, 12],
      [83_000, 7_740_00, 22],
      [121_250, 16_155_00, 24],
      [217_300, 39_207_00, 32],
      [271_750, 56_631_00, 35],
      [656_150, 191_171_00, 37],
    ],
  },
  // Form W-4, Step 2, Checkbox, Withholding Rate Schedules.
  step2Checkbox: {
    married: [
      [0, 0, 0],
      [16_100, 0, 10],
      [28_500, 1_240_00, 12],
      [66_500, 5_800_00, 22],
      [121_800, 17_966_00, 24],
      [217_875, 41_024_00, 32],
      [272_325, 58_448_00, 35],
      [400_450, 103_291_75, 37],
    ],
    single: [
      [0, 0, 0],
      [8_050, 0, 10],
      [14_250, 620_00, 12],
      [33_250, 2_900_00, 22],
      [60_900, 8_983_00, 24],
      [108_938, 20_512_00, 32],
      [136_163, 29_224_00, 35],
      [328_350, 96_489_63, 37],
    ],
    head: [
      [0, 0, 0],
      [12_075, 0, 10],
      [20_925, 885_00, 12],
      [45_800, 3_870_00, 22],
      [64_925, 8_077_50, 24],
      [112_950, 19_603_50, 32],
      [140_175, 28_315_50, 35],
      [332_375, 95_585_50, 37],
    ],
  },
  socialSecurity: { rateBasisPoints: 620, wageBaseCents: 184_500_00 },
  medicare: { rateBasisPoints: 145, additionalRateBasisPoints: 90, additionalThresholdCents: 200_000_00 },
  // Pub. 15 (2026), "Supplemental Wages": the flat rate for supplemental wages of up to $1 million in a year.
  // (Supplemental wages above $1 million a year are withheld at the highest rate; that is not modelled.)
  supplemental: { rateBasisPoints: 2200 },
};
