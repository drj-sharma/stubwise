import { formatPeriod, formatShortDate } from '@stubwise/domain';
import { type StubDocument, buildStubDocument, renderStubHtml, stubFileName } from '@stubwise/templates';
import { File, Paths } from 'expo-file-system';
import * as MailComposer from 'expo-mail-composer';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { getStub, getWorker, listStubs } from '@/api/records';
import type { Business, Stub, Worker } from '@/db/types';

export interface RenderedStub {
  stub: Stub;
  worker: Worker;
  document: StubDocument;
  html: string;
}

/**
 * Builds the printable stub for one saved stub, from the server's copy of the
 * stub and the worker's history. The figures come from the same shared
 * calculation code the editor shows (and the server runs), and the layout
 * from the business's chosen template, so the PDF always matches the screen.
 * The PDF itself is made on the phone; it is never uploaded.
 */
export async function renderStub(business: Business, stubId: string): Promise<RenderedStub | null> {
  const stub = await getStub(stubId);
  if (!stub) return null;
  const [worker, workerStubs] = await Promise.all([getWorker(stub.workerId), listStubs(stub.workerId)]);
  if (!worker) return null;
  const extras = {
    showPto: business.showPto,
    showEmployerTaxes: business.showEmployerTaxes,
    showDepositSlip: business.showDepositSlip,
    pto: stub.pto,
    employerTaxes: stub.employerTaxes,
  };
  const document = buildStubDocument({ business, worker, stub, workerStubs, extras });
  const html = renderStubHtml(document, business.templateId, { accent: business.accent });
  return { stub, worker, document, html };
}

/** US Letter in PDF points (72 per inch). */
const LETTER = { width: 612, height: 792 };

/** Makes the PDF on the device and returns its file URI, named after the worker and pay date. */
export async function createStubPdf(rendered: RenderedStub): Promise<string> {
  const printed = await Print.printToFileAsync({ html: rendered.html, ...LETTER });
  const target = new File(Paths.cache, stubFileName(rendered.worker.name, rendered.stub.payDate));
  if (target.exists) target.delete();
  await new File(printed.uri).move(target);
  return target.uri;
}

export async function shareStubPdf(rendered: RenderedStub): Promise<void> {
  const uri = await createStubPdf(rendered);
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Sharing is not available on this device.');
  }
  await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: 'Share pay stub' });
}

/** Why a stub could not be emailed from this phone; the screen offers Share PDF instead. */
export class MailUnavailableError extends Error {
  constructor() {
    super('No email account is set up on this phone. Use Share PDF to send the stub another way.');
  }
}

/**
 * Opens the phone's own mail composer addressed to the worker, with the PDF
 * attached. The PDF is made on the device and goes out from the owner's own
 * email account: the app's server never sees it. Returns false when the owner
 * closed the composer without sending.
 */
export async function emailStubPdf(rendered: RenderedStub, businessName: string): Promise<boolean> {
  if (!(await MailComposer.isAvailableAsync())) throw new MailUnavailableError();
  const uri = await createStubPdf(rendered);
  const { stub, worker } = rendered;
  const result = await MailComposer.composeAsync({
    recipients: [worker.email],
    subject: `Your pay stub from ${businessName} · paid ${formatShortDate(stub.payDate)}`,
    body: `Hi ${worker.name.split(' ')[0]},\n\nYour pay stub for ${formatPeriod(stub.period)} is attached.\n\n${businessName}`,
    attachments: [uri],
  });
  return result.status === MailComposer.MailComposerStatus.SENT;
}

export async function printStub(rendered: RenderedStub): Promise<void> {
  await Print.printAsync({ html: rendered.html, ...LETTER });
}
