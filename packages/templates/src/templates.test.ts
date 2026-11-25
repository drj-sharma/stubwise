import { type StubLine, type YtdStub, toMinutes } from '@stubwise/domain';
import { type BuildStubDocumentInput, type StubExtrasInput, buildStubDocument, stubFileName } from './document';
import { TEMPLATES, isTemplateId, renderStubHtml } from './registry';

const hourly = (label: string, h: number, m: number, rateCents: number): StubLine => ({
  kind: 'earning',
  label,
  minutes: toMinutes(h, m),
  rateCents,
  amountCents: 0,
  source: 'manual',
});
const flat = (kind: StubLine['kind'], label: string, amountCents: number): StubLine => ({
  kind,
  label,
  minutes: null,
  rateCents: null,
  amountCents,
  source: 'manual',
});

const earlier: YtdStub = {
  id: 's3',
  payDate: '2026-11-13',
  createdAt: '2026-11-12T10:00:00Z',
  lines: [hourly('Regular', 80, 0, 2400), flat('deduction', 'Health insurance', 8500)],
};

function input(overrides: Partial<BuildStubDocumentInput['business']> = {}): BuildStubDocumentInput {
  const stub = {
    id: 's4',
    payDate: '2026-11-27',
    createdAt: '2026-11-26T10:00:00Z',
    period: { start: '2026-11-09', end: '2026-11-22' },
    lines: [
      hourly('Regular', 76, 45, 2400),
      hourly('Overtime', 3, 30, 3600),
      flat('earning', 'Bonus', 7500),
      flat('deduction', 'Federal income tax', 18600),
      flat('deduction', 'Health insurance', 8500),
    ],
  };
  return {
    business: {
      name: 'Ridgeline Auto Repair',
      address: '2140 Alder St, Chattanooga, TN 37404',
      phone: '(423) 555-0142',
      employerId: '62-1847305',
      logoDataUri: null,
      paySchedule: 'biweekly',
      showEmployerId: true,
      ...overrides,
    },
    worker: {
      name: 'Marcus Bell',
      address: '418 Dodson Ave, Chattanooga, TN 37406',
      type: 'employee',
      payType: 'hourly',
      rateCents: 2400,
      startingYtd: { year: 2026, lines: [{ kind: 'earning', label: 'Regular', amountCents: 1000000 }] },
    },
    stub,
    workerStubs: [earlier, stub],
  };
}

describe('stub document', () => {
  it('carries the same totals the screen shows', () => {
    const doc = buildStubDocument(input());
    expect(doc.totals.current).toMatchObject({ grossCents: 204300, deductionsCents: 27100, netCents: 177200 });
    expect(doc.totals.ytd.grossCents).toBe(1000000 + 192000 + 204300);
  });

  it('gives each line its own year-to-date figure', () => {
    const doc = buildStubDocument(input());
    const regular = doc.earnings.find((row) => row.label === 'Regular');
    const bonus = doc.earnings.find((row) => row.label === 'Bonus');
    const health = doc.deductions.find((row) => row.label === 'Health insurance');
    expect(regular?.ytdCents).toBe(1000000 + 192000 + 184200);
    expect(bonus?.ytdCents).toBe(7500);
    expect(health?.ytdCents).toBe(17000);
    expect(bonus?.minutes).toBeNull();
  });

  it('leaves out a line with no hours, no pay and nothing year to date', () => {
    const base = input();
    const stub = { ...base.stub, lines: [hourly('Regular', 40, 0, 2400), hourly('Overtime', 0, 0, 3600)] };
    const unused = buildStubDocument({ ...base, stub, workerStubs: [stub] });
    expect(unused.earnings.map((row) => row.label)).toEqual(['Regular']);

    // Overtime earlier in the year keeps the row, so its year-to-date still prints.
    const before = { ...earlier, lines: [hourly('Overtime', 2, 0, 3600)] };
    const used = buildStubDocument({ ...base, stub, workerStubs: [before, stub] });
    expect(used.earnings.map((row) => row.label)).toEqual(['Regular', 'Overtime']);
  });

  it('hides the employer ID when the business turned it off', () => {
    expect(buildStubDocument(input({ showEmployerId: false })).business.employerId).toBeNull();
  });

  it('masks the Social Security number down to its last four digits', () => {
    const base = input();
    const withSsn = (ssnLast4: string | undefined): ReturnType<typeof buildStubDocument> =>
      buildStubDocument({ ...base, worker: { ...base.worker, ssnLast4 } });
    expect(withSsn('7483').worker.ssnLabel).toBe('XXX-XX-7483');
    expect(withSsn('').worker.ssnLabel).toBeNull();
    expect(withSsn(undefined).worker.ssnLabel).toBeNull();
    // Anything that is not exactly four digits is never printed, so a full number cannot reach a stub.
    expect(withSsn('123456789').worker.ssnLabel).toBeNull();
    expect(withSsn('12ab').worker.ssnLabel).toBeNull();
  });

  it('prints the masked number on every template, and nothing when there is none', () => {
    const base = input();
    const masked = buildStubDocument({ ...base, worker: { ...base.worker, ssnLast4: '7483' } });
    const plain = buildStubDocument(base);
    for (const { id } of TEMPLATES) {
      expect(renderStubHtml(masked, id)).toContain('XXX-XX-7483');
      expect(renderStubHtml(plain, id)).not.toContain('XXX-XX');
    }
  });

  it('names the PDF file after the worker and pay date', () => {
    expect(stubFileName('Marcus Bell', '2026-11-27')).toBe('Marcus-Bell-2026-11-27.pdf');
    expect(stubFileName('../../etc', '2026-11-27')).toBe('etc-2026-11-27.pdf');
    expect(stubFileName('', '2026-11-27')).toBe('Pay-stub-2026-11-27.pdf');
  });
});

describe('template library', () => {
  const doc = buildStubDocument(input());

  it('lists four templates with unique ids', () => {
    expect(TEMPLATES.map((template) => template.id)).toEqual(['classic', 'modern', 'compact', 'ledger']);
    expect(isTemplateId('modern')).toBe(true);
    expect(isTemplateId('fancy')).toBe(false);
  });

  it.each(TEMPLATES.map((template) => template.id))('%s prints every figure that matters', (id) => {
    const html = renderStubHtml(doc, id);
    expect(html.startsWith('<!doctype html>')).toBe(true);
    for (const text of [
      'Ridgeline Auto Repair',
      'Marcus Bell',
      'Nov 9 – Nov 22, 2026',
      'Nov 27, 2026',
      '76:45',
      '$1,842.00',
      '$126.00',
      '$75.00',
      '$2,043.00',
      '$271.00',
      '$1,772.00',
      '62-1847305',
    ]) {
      expect(html).toContain(text);
    }
  });

  it.each(TEMPLATES.map((template) => template.id))('%s escapes text typed by the user', (id) => {
    const hostile = input({ name: '<script>alert(1)</script> & Sons' });
    hostile.worker.name = 'Bobby "Tables" <b>';
    const html = renderStubHtml(buildStubDocument(hostile), id);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('prints a contractor stub with no deductions table rows', () => {
    const contractor = input();
    contractor.worker.type = 'contractor';
    contractor.stub.lines = [hourly('Regular', 46, 30, 3200)];
    contractor.workerStubs = [contractor.stub];
    contractor.worker.startingYtd = null;
    const html = renderStubHtml(buildStubDocument(contractor), 'classic');
    expect(html).toContain('$1,488.00');
    expect(html).not.toContain('Total deductions</td>');
    expect(html).toContain('1099 contractor');
  });

  it('applies a valid accent colour and ignores an invalid one', () => {
    expect(renderStubHtml(doc, 'modern', { accent: '#0A7D4F' })).toContain('#0A7D4F');
    const fallback = renderStubHtml(doc, 'modern', { accent: 'red; } body { display:none' });
    expect(fallback).not.toContain('display:none');
    expect(fallback).toContain('#3F3D9E');
  });

  it('only embeds image data URIs as a logo', () => {
    const withLogo = buildStubDocument(input({ logoDataUri: 'data:image/png;base64,iVBORw0KGgo=' }));
    expect(renderStubHtml(withLogo, 'classic')).toContain('src="data:image/png;base64,iVBORw0KGgo="');
    const hostile = buildStubDocument(input({ logoDataUri: 'https://example.com/track.png' }));
    expect(renderStubHtml(hostile, 'classic')).not.toContain('example.com');
  });
});

describe('per-unit pay', () => {
  const miles = (quantityMilli: number): StubLine => ({
    kind: 'earning',
    label: 'Miles',
    minutes: null,
    rateCents: 62,
    quantityMilli,
    unit: 'mile',
    amountCents: 0,
    source: 'manual',
  });
  const perMile = (lines: StubLine[]): BuildStubDocumentInput => {
    const base = input();
    const stub = { ...base.stub, lines };
    return { ...base, worker: { ...base.worker, payType: 'mile', rateCents: 62, startingYtd: null }, stub, workerStubs: [stub] };
  };

  it('gives a per-unit row its quantity, unit and rate, and not hours', () => {
    const doc = buildStubDocument(perMile([miles(842_500)]));
    expect(doc.earnings).toEqual([
      { label: 'Miles', minutes: null, quantityMilli: 842_500, unit: 'mile', rateCents: 62, currentCents: 52_235, ytdCents: 52_235 },
    ]);
    expect(doc.worker.rateLabel).toBe('$0.62 per mile');
    expect(doc.worker.typeLabel).toBe('Paid per mile');
    expect(doc.totals.current).toMatchObject({ grossCents: 52_235, totalMinutes: 0 });
  });

  it('keeps a row with units but no pay yet, and leaves out one with nothing', () => {
    expect(buildStubDocument(perMile([miles(0)])).earnings).toEqual([]);
    expect(buildStubDocument(perMile([{ ...miles(10), rateCents: 0 }])).earnings).toHaveLength(1);
  });

  it.each(TEMPLATES.map((template) => template.id))('%s prints the units and the rate per unit', (id) => {
    const html = renderStubHtml(buildStubDocument(perMile([miles(842_500), miles(1000)])), id);
    expect(html).toContain('842.5 miles');
    expect(html).toContain('1 mile');
    expect(html).toContain('$0.62/mile');
    expect(html).toContain('$522.35');
  });

  it('a contractor stays a 1099 contractor', () => {
    const base = perMile([miles(1000)]);
    const doc = buildStubDocument({ ...base, worker: { ...base.worker, type: 'contractor' } });
    expect(doc.worker.typeLabel).toBe('1099 contractor');
  });
});

describe('optional extras', () => {
  const extras = (overrides: Partial<StubExtrasInput> = {}): StubExtrasInput => ({
    showPto: true,
    showEmployerTaxes: true,
    showDepositSlip: true,
    pto: {
      sick: { accruedMinutes: 90, usedMinutes: 60, availableMinutes: 630 },
      vacation: { accruedMinutes: 120, usedMinutes: 0, availableMinutes: -30 },
    },
    employerTaxes: [
      { label: 'FUTA', amountCents: 1104, ytdCents: 2208 },
      { label: 'SUTA <b>', amountCents: 5520, ytdCents: 11040 },
      { label: 'Unused', amountCents: 0, ytdCents: 0 },
    ],
    ...overrides,
  });
  const ids = TEMPLATES.map((template) => template.id);

  it('prints nothing extra by default, so existing stubs look as they did', () => {
    const plain = buildStubDocument(input());
    expect(plain.pto).toBeNull();
    expect(plain.employerTaxes).toEqual([]);
    expect(plain.depositSlip).toBeNull();
    for (const id of ids) {
      const html = renderStubHtml(plain, id);
      for (const text of ['Paid time off', 'Employer-paid', 'Detach', 'Deposit slip']) expect(html).not.toContain(text);
    }
  });

  it('stays off when the switches are off even if the figures are supplied', () => {
    const doc = buildStubDocument({ ...input(), extras: extras({ showPto: false, showEmployerTaxes: false, showDepositSlip: false }) });
    expect([doc.pto, doc.employerTaxes, doc.depositSlip]).toEqual([null, [], null]);
  });

  it.each(ids)('%s prints time off, employer taxes and the deposit slip when on', (id) => {
    const html = renderStubHtml(buildStubDocument({ ...input(), extras: extras() }), id);
    for (const text of [
      'Paid time off',
      'Sick leave',
      '10:30', // 630 minutes available
      '−0:30', // a balance below zero keeps its sign
      'Employer-paid',
      '$11.04',
      '$110.40',
      'Not deducted from net pay',
      'Detach',
      'Deposit slip',
    ]) {
      expect(html).toContain(text);
    }
    expect(html).not.toContain('Unused');
    expect(html).not.toContain('<b>');
    expect(html).toContain('SUTA &lt;b&gt;');
  });

  it('does not let employer taxes change net pay, and the slip shows the net pay', () => {
    const doc = buildStubDocument({ ...input(), extras: extras() });
    expect(doc.totals.current.netCents).toBe(177200);
    expect(doc.depositSlip).toEqual({ netCents: 177200 });
    expect(doc.totals.current.deductionsCents).toBe(27100);
  });

  it.each(ids)('%s puts the net pay on the slip', (id) => {
    const html = renderStubHtml(buildStubDocument({ ...input(), extras: extras({ showPto: false, showEmployerTaxes: false }) }), id);
    const slip = html.slice(html.indexOf('Detach'));
    expect(slip).toContain('$1,772.00');
    expect(slip).toContain('Marcus Bell');
    expect(slip).toContain('Nov 27, 2026');
  });
});
