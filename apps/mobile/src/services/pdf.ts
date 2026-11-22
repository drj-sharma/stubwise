import { type StubDocument, buildStubDocument, renderStubHtml, stubFileName } from '@stubwise/templates';
import { File, Paths } from 'expo-file-system';
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
  const document = buildStubDocument({ business, worker, stub, workerStubs });
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

export async function printStub(rendered: RenderedStub): Promise<void> {
  await Print.printAsync({ html: rendered.html, ...LETTER });
}
