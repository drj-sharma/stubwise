import type { StubDocument } from './document';
import { renderClassic } from './templates/classic';
import { renderCompact } from './templates/compact';
import { renderLedger } from './templates/ledger';
import { renderModern } from './templates/modern';

export type TemplateId = 'classic' | 'modern' | 'compact' | 'ledger';

export interface TemplateOptions {
  /** Hex colour used by templates that have an accent. */
  accent: string;
}

export interface TemplateInfo {
  id: TemplateId;
  name: string;
  description: string;
  /** Whether the template uses the accent colour at all. */
  usesAccent: boolean;
}

export const DEFAULT_TEMPLATE_ID: TemplateId = 'classic';
export const DEFAULT_ACCENT = '#3F3D9E';

/** The template library, in the order shown in the picker. */
export const TEMPLATES: readonly TemplateInfo[] = [
  { id: 'classic', name: 'Classic', description: 'Black on white, full page, boxed net pay.', usesAccent: false },
  { id: 'modern', name: 'Modern', description: 'Coloured header band and tinted net pay panel.', usesAccent: true },
  { id: 'compact', name: 'Compact', description: 'Top third of the page; print above a check or cut as a slip.', usesAccent: false },
  { id: 'ledger', name: 'Ledger', description: 'Fully ruled grid, like a payroll register.', usesAccent: false },
];

const RENDERERS: Record<TemplateId, (document: StubDocument, options: TemplateOptions) => string> = {
  classic: renderClassic,
  modern: renderModern,
  compact: renderCompact,
  ledger: renderLedger,
};

export function isTemplateId(value: unknown): value is TemplateId {
  return typeof value === 'string' && value in RENDERERS;
}

/** Renders one pay stub as a complete, print-ready HTML page. */
export function renderStubHtml(
  document: StubDocument,
  templateId: TemplateId = DEFAULT_TEMPLATE_ID,
  options: Partial<TemplateOptions> = {},
): string {
  const accent = options.accent && /^#[0-9a-fA-F]{6}$/.test(options.accent) ? options.accent : DEFAULT_ACCENT;
  return RENDERERS[templateId](document, { accent });
}
