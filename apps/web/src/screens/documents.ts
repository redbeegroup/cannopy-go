import type { Document } from '@cannopy/core';
import type { TFunction } from 'i18next';

/** Plain name for a document in lists: "Sale #12", "Rent", "Got paid". */
export function documentTitle(doc: Document, t: TFunction): string {
  const base = t(`doc.${doc.type}`);
  return doc.number ? `${base} #${doc.number}` : base;
}

/** Which way money went, for colouring amounts. */
export function documentTone(doc: Document): 'in' | 'out' | 'neutral' {
  switch (doc.type) {
    case 'sale':
    case 'payment_in':
    case 'owner_in':
      return 'in';
    case 'purchase':
    case 'expense':
    case 'payment_out':
    case 'owner_out':
      return 'out';
    default:
      return 'neutral';
  }
}

/** The screen that edits a document of this type. */
export function editPath(doc: Document): string | null {
  switch (doc.type) {
    case 'sale':
      return `/sell/${doc.id}`;
    case 'expense':
      return `/spend/${doc.id}`;
    case 'purchase':
      return `/buy/${doc.id}`;
    case 'payment_in':
      return `/get-paid/${doc.id}`;
    case 'payment_out':
      return `/pay/${doc.id}`;
    case 'owner_in':
    case 'owner_out':
      return `/owner/${doc.id}`;
    case 'transfer':
      return `/transfer/${doc.id}`;
    default:
      return null;
  }
}
