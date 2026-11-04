/**
 * csvImport.js — parses a CSV of invoices for bulk import.
 *
 * Deliberately a small hand-rolled parser rather than a dependency: the
 * input shape is simple (one invoice per row, a known small set of
 * columns) and this keeps the import endpoint dependency-free. Handles
 * RFC4180-style quoted fields (commas and escaped quotes inside a quoted
 * value) since a client name like "Acme, Inc." is a realistic input.
 *
 * Column names are matched case-insensitively and in any order. Only
 * client_name and amount are required — everything else falls back to the
 * same defaults POST /api/agent/invoices uses for a single manual create,
 * so a CSV with just two columns is a valid (if minimal) import.
 */

const REQUIRED_COLUMNS = ['client_name', 'amount'];
const KNOWN_COLUMNS = [
  'invoice_id',
  'client_name',
  'amount',
  'email',
  'days_overdue',
  'ignored_reminders',
  'relationship_score',
  'historical_on_time_rate',
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Splits one CSV line into fields, honoring double-quoted fields that may
 *  contain commas, newlines (not needed here since we split on lines first,
 *  but harmless), or an escaped `""` for a literal quote. */
function splitCsvLine(line) {
  const fields = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      fields.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  fields.push(cur);
  return fields.map((f) => f.trim());
}

/** Parses raw CSV text into { invoices, errors, skippedEmptyRows }.
 *  `invoices` are plain objects ready for store.saveNewInvoice (still
 *  missing invoice_id/scenario — the caller assigns those, same as the
 *  single-create endpoint does, so numbering stays consistent across both
 *  paths). `errors` is one entry per row that couldn't be used, with the
 *  1-based row number (counting the header as row 1, matching what a
 *  person sees if they open the file in a spreadsheet). */
function parseInvoiceCsv(csvText) {
  const errors = [];
  const invoices = [];

  if (!csvText || !csvText.trim()) {
    return { invoices, errors: [{ row: 0, error: 'The file is empty.' }] };
  }

  // Normalize line endings, strip a leading UTF-8 BOM (Excel loves adding
  // one), and drop fully-blank lines rather than erroring on them — a
  // trailing blank line at EOF is extremely common and not a mistake.
  const lines = csvText
    .replace(/^﻿/, '')
    .split(/\r\n|\r|\n/)
    .filter((l) => l.trim().length > 0);

  if (lines.length === 0) {
    return { invoices, errors: [{ row: 0, error: 'The file is empty.' }] };
  }

  const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const colIndex = {};
  header.forEach((h, i) => { colIndex[h] = i; });

  const missingRequired = REQUIRED_COLUMNS.filter((c) => !(c in colIndex));
  if (missingRequired.length > 0) {
    return {
      invoices,
      errors: [{
        row: 1,
        error: `Missing required column(s): ${missingRequired.join(', ')}. Expected a header row with at least: ${REQUIRED_COLUMNS.join(', ')}.`,
      }],
    };
  }

  const unknownColumns = header.filter((h) => h && !KNOWN_COLUMNS.includes(h));
  const warnings = unknownColumns.length > 0
    ? [`Ignored unrecognized column(s): ${unknownColumns.join(', ')}.`]
    : [];

  for (let i = 1; i < lines.length; i++) {
    const rowNum = i + 1; // 1-based, header is row 1
    const fields = splitCsvLine(lines[i]);
    const get = (col) => (colIndex[col] != null ? fields[colIndex[col]] : undefined);

    const clientName = (get('client_name') || '').trim();
    const amountRaw = (get('amount') || '').trim();

    if (!clientName || !amountRaw) {
      errors.push({ row: rowNum, error: 'Missing client_name or amount.' });
      continue;
    }
    const amount = Number(amountRaw);
    if (!Number.isFinite(amount) || amount <= 0) {
      errors.push({ row: rowNum, error: `"${amountRaw}" isn't a valid amount.` });
      continue;
    }

    const emailRaw = (get('email') || '').trim();
    if (emailRaw && !EMAIL_RE.test(emailRaw)) {
      errors.push({ row: rowNum, error: `"${emailRaw}" doesn't look like a valid email address.` });
      continue;
    }

    const daysOverdue = get('days_overdue') ? Number(get('days_overdue')) : 0;
    const ignoredReminders = get('ignored_reminders') ? Number(get('ignored_reminders')) : 0;
    const relationshipScore = get('relationship_score') ? Number(get('relationship_score')) : 75;
    let onTimeRate = get('historical_on_time_rate') ? Number(get('historical_on_time_rate')) : 0.8;
    // Accept either 0-1 or 0-100 — a spreadsheet-authored CSV is at least as
    // likely to have "80" as "0.8" in this column, and silently treating 80
    // as 8000% is a worse failure mode than normalizing it.
    if (onTimeRate > 1) onTimeRate = onTimeRate / 100;

    const invoiceIdRaw = (get('invoice_id') || '').trim();

    invoices.push({
      ...(invoiceIdRaw ? { invoice_id: invoiceIdRaw } : {}),
      client_name: clientName,
      amount,
      days_overdue: Number.isFinite(daysOverdue) ? daysOverdue : 0,
      ignored_reminders: Number.isFinite(ignoredReminders) ? ignoredReminders : 0,
      relationship_score: Number.isFinite(relationshipScore) ? relationshipScore : 75,
      historical_on_time_rate: Number.isFinite(onTimeRate) ? onTimeRate : 0.8,
      ...(emailRaw ? { email: emailRaw } : {}),
    });
  }

  return { invoices, errors, warnings };
}

module.exports = { parseInvoiceCsv };
