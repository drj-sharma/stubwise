# State tax rules

Every state tax on wages that CrewStub works out is a row in the `tax_rules`
table: one row per **year**, **jurisdiction** (a state code, or `DC`) and
**tax**. The calculations read the table (through `store.RULES`). The JSON files
in `data/<year>/<STATE>.json` are the seed: on startup each rule is written to
the table unless the row there has the same or a higher `revision`.

To correct a figure, change the seed file and raise that rule's `revision` by 1
(or edit the row in the database with a higher revision).

## A seed file

```json
{
  "year": 2026,
  "jurisdiction": "CA",
  "rules": [
    { "tax": "income", "method": "state", "params": { ... }, "source": "https://...", "revision": 1 },
    { "tax": "sdi", "method": "capped_rate", "params": { ... }, "source": "https://...", "revision": 1 }
  ]
}
```

`tax` is one of:

| tax | what | stub line code |
|---|---|---|
| `income` | state income tax (required: every state and DC has one row) | `sit` |
| `sdi` | state disability insurance | `sdi` |
| `fli` | family leave insurance (when separate from SDI) | `fli` |
| `pfml` | paid family and medical leave | `pfml` |
| `ui` | the worker's share of unemployment insurance | `ui` |
| `ltc` | long-term care (Washington Cares) | `ltc` |
| `transit` | a state transit tax on wages (Oregon) | `transit` |
| `local` | county, city or school-district income taxes | `local:<code>` |

`method` is one of:

- `none`: the state has no such tax (used for `income` in the states without one).
- `manual`: the state has it but it is not calculated; the stub gets a line for the
  employer to type the amount. `params.label` may name the line.
- `state`: the state's own formula, `app/domain/tax/states/<state>.py`, reading its
  figures from `params`. Only for `income`.
- `capped_rate`: a percent of wages with optional caps. Params: `ratePercent`
  (string, the worker's rate: "1.3"), optional `wageBaseCents` (annual wage base),
  `maxAnnualCents` (most a worker pays in a year), `maxPerWeekCents` (most per week),
  `label`, `optional` (true when a worker may be excluded; they are when the
  certificate's `options[<code>]` is false).
- `local_rate`: a percent of wages for each place the worker has chosen. Params:
  `choose` (what to call the choice: "City", "County"), `label` ("{name} city tax"),
  `localities`: `{ "<CODE>": { "name": "Detroit (resident)", "ratePercent": "2.4" } }`.
  The worker's choice is the code in their certificate's `localities` list. Codes are
  up to 14 letters, digits or dashes.

Every amount is **integer cents**; every rate is a **percent string** ("4.95"), never
a float. `source` is the official page or publication the figures were read from.

## Changes during the year

`params` hold the latest figures. When a state changed them part way through the
year, list the figures that applied before under `params.earlier`, each covering
pay dates up to and including `until`; only the keys that changed are needed:

```json
"params": {
  "ratePercent": "4.99",
  "earlier": [{ "until": "2026-05-10", "params": { "ratePercent": "5.19" } }]
}
```

The engine picks the figures in force on the stub's pay date (`in_force` in
`app/domain/tax/state.py`). A whole key is replaced, so an earlier `localities`
must list every place. An entry may also carry a `source` naming the
publication those earlier figures come from; the engine ignores it.

## Income: `method: "state"`

`app/domain/tax/states/<state>.py` exports:

```python
def withhold(params: dict[str, Any], inp: StateInput) -> Withheld: ...
```

`StateInput` (in `states/_common.py`) has the period's taxable `wages_cents`,
`periods_per_year`, `annual_wages` (exact), the federal `w4`, the state certificate
`cert`, `federal_tax_cents` and `fica_cents` withheld this period, and
`prior_ytd_wages_cents`. Return `Withheld(cents)` for the state income tax line, with
`extra_lines` for any further lines the same formula makes (an Indiana county tax:
`("local:county", "Marion County tax", cents)`).

Do **not** handle `cert["exempt"]` or `cert["extraWithholdingCents"]`: the engine does
(exempt gives 0, extra is added on top when there is pay).

`_common.annualized(params, inp)` covers the common percentage method:
annual wages, less `standardDeductionCents`, less `perField` amounts per certificate
count, then `ratePercent` or `brackets`, less `creditCents` and `creditPerField`,
divided by pay periods with `round` (`cent`, `dollar`, `annual-dollar`). Figures can be
one value or a map by status (`{"single": ..., "married": ..., "*": ...}`). Brackets
are `[[over_cents, "rate percent"], ...]`, ascending. A state that needs more writes its
own steps in its module with the helpers there (`bracket_tax`, `pct`, `per_period`,
`status_of`, `by_status`, `count`, `option`). Formulas live in the module; **every
figure lives in `params`**.

Status: `status_of(params, inp)` returns the certificate's own `status` if the
worker gave one (and it is in `params.statuses`), else the federal W-4 status mapped
through `params.statusFromFederal`, else `params.defaultStatus`. A worker with no
state certificate on file must get what the state's guide says for that case.

### `params.certificate`

What the worker form asks for. Shown in the app only for calculated states.

```json
"certificate": {
  "form": "DE 4",
  "fields": [
    { "key": "status", "label": "Filing status", "kind": "choice",
      "options": [{ "value": "S", "label": "Single or married with two incomes" }] },
    { "key": "allowances", "label": "Regular withholding allowances", "kind": "count" },
    { "key": "additionalAllowances", "label": "Estimated deduction allowances", "kind": "count" },
    { "key": "dependents", "label": "Dependents", "kind": "count" },
    { "key": "options.rate", "label": "Withholding percentage", "kind": "choice", "options": [...] }
  ]
}
```

`kind` is `count`, `choice`, `switch` or `money` (cents). Keys are `status`,
`allowances`, `additionalAllowances`, `dependents`, or `options.<name>` for anything
else (read with `option(inp, name)` or `count(inp, name)`). Extra withholding and
"exempt" are always asked, so they are not listed.

A state whose income formula needs a county (Maryland, Indiana) lists the choices
in `params.localities`: `{"choose": "County", "options": [{"code": "...", "name": "..."}]}`;
the worker's choice arrives in `cert["localities"]`.

## Tests

Each calculated state has `tests/tax_states/test_<state>.py`, built from the worked
examples in the state's own publication wherever it gives them, using
`tests/tax_states/helpers.py`:

```python
assert withhold("IL", 2026, wages_cents=200_000, periods=26, cert={"allowances": 1}) == {"sit": 9343}
```
