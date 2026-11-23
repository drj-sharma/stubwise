# Sending stubs, corrections, old W-4s and year-end (decisions and audit)

From the 123PayStubs competitor analysis.

## 1. Send to worker: the phone's mail composer, not a server mailer

**Decision.** The stub screen's **Send to worker** button opens the phone's own mail composer
(`expo-mail-composer`) addressed to the worker's email, with the PDF attached.

**Why.**
- The PDF is made on the phone at the moment of sending and is deliberately never uploaded
  (see `services/pdf.ts`). A server mailer would need the phone to upload the PDF (or the server to
  re-render it, which means porting the templates), plus a paid email provider and the
  deliverability work (SPF/DKIM, bounces) that comes with it.
- Sending from the owner's own mail account is what a worker expects ("from my boss"), replies go to
  the owner, and no worker email or pay data passes through CrewStub's server.
- With no mail account on the phone the app says so and the owner uses **Share PDF**. The iOS
  Simulator has no mail account, so there the button shows that message.

**If a server mailer is wanted later** (for example to email stubs on a schedule, which a phone
cannot do): add `POST /v1/stubs/{id}/send` taking the PDF as `application/pdf` (cap about 1 MB),
with a `Mailer` interface in `app/services/mailer.py` (`send(to, subject, body, attachment)`),
chosen by `MAIL_PROVIDER` = `resend` | `smtp` | `none`. `none` (the default, and in tests) logs and
returns without sending; Resend reads `RESEND_API_KEY`, SMTP reads `SMTP_HOST/PORT/USER/PASSWORD`;
`MAIL_FROM` is the sender. No key is ever in the repo. Rate-limit it per user and write it to the
audit log. Not built, because it needs new paid infrastructure.

The worker's email is stored on the worker (`workers.email`, migration `0006`), edited on the worker
form, and included in backups.

## 2. Pre-2020 Form W-4

Not handled before: `federal_income_tax` only did Worksheet 1A for 2020-or-later forms. Added in both
`packages/domain/src/tax/federal.ts` and `apps/backend/app/domain/tax/federal.py`.

Pub. 15-T (2026), Worksheet 1A, lines 1j-1l: for a W-4 from 2019 or earlier the adjusted annual wage
is annual wages minus allowances x $4,300 (`legacyAllowanceCents`), then the **STANDARD** schedule
for the marital status (Single, or Married filing jointly) is used, never Head of Household and
never the Step 2 checkbox schedule; Steps 3 and 4(a)/(b) do not apply; line 6 extra withholding is
added. So no new bracket table was needed: the only new figure is the $4,300 allowance in
`data/federal-2026.ts`. `W4` gains `legacy` and `allowances`; the worker form has a "Form W-4 is
from 2019 or earlier" switch and an allowances field. Stored profiles without the new fields read as
`legacy: false`.

## 3. Free corrections after paying

Only a confirmed payment writes an `orders` row; editing lines, moving the pay date or changing the
worker never touches orders (tested in `tests/test_send_and_correct.py`). The stub editor asks
`GET /v1/orders?stubId=` and shows **Corrections are free** on a paid stub. No payment flow exists
in the app yet; when it is added it must create an order per *first* payment of a stub only.

## 4. Year-end audit

| | 123PayStubs / Paystubs.app | CrewStub today |
|---|---|---|
| W-2 and 1099-NEC e-file | yes | Backend only (`/v1/filings`, TaxBandits), **parked**, never run against the sandbox, **no app screen** |
| Per-worker year totals | W-2 style summary | **Added**: Reports > Year-end totals (box-labelled figures, from the existing server reports) |
| Earnings and deductions by worker and date range | yes | Yes (Reports, PDF and CSV) |
| Printable W-2 / 1099 PDF to hand to the worker | yes | **Gap** |
| 941 / 940 quarterly summaries | no | Gap (not offered by competitor either) |
| SS wages (box 3/5) capped at the wage base, Box 12 codes | partly | **Gap**: totals show tax withheld, not the capped wage boxes |

Smallest next steps: wire the parked filing flow to an app screen once the TaxBandits sandbox
checks in `apps/backend/README.md` pass; render a one-page W-2/1099 PDF from the year-end totals.
