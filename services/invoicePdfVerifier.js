/**
 * Invoice PDF verifier for the admin-dev console.
 *
 * Answers one question: does this uploaded PDF still agree with the invoice
 * record the app actually issued?
 *
 * IMPORTANT — read before extending. The invoice watermark cannot answer that
 * question and this module deliberately does not pretend otherwise. See
 * `WATERMARK_LIMITS` below.
 */
const zlib = require('zlib');

/**
 * What the watermark can and cannot prove, stated explicitly because the
 * tempting feature — "verify the watermark to detect tampering" — would be
 * false advertising.
 *
 * `InvoiceNumberGeneratorService.generateWatermark` computes
 *   HMAC-SHA256(secret, invoiceNumber)
 * and injects it as zero-width characters. Consequences:
 *
 *   1. It covers the invoice NUMBER ONLY. Change the amount, the dates, the
 *      line items or the client and the watermark is still valid. It therefore
 *      cannot detect a modified invoice, which is the thing people assume it
 *      does.
 *   2. The secret is generated per device in SharedPreferences and never
 *      leaves that device. A verifier running anywhere else — this server
 *      included — does not have it, so it cannot recompute the HMAC even for
 *      the number it does cover.
 *   3. The watermark is not persisted on the invoice record, so there is no
 *      server-side copy to compare an uploaded file against.
 *
 * So all this module can honestly report about the watermark is whether a
 * payload is present at all. Presence is a weak provenance signal: it means the
 * file was emitted by a build of the app, and that nobody stripped the
 * invisible characters.
 */
const WATERMARK_LIMITS = {
  coversContentOnly: false,
  serverHasSecret: false,
  persistedOnInvoice: false,
};

const ZERO_WIDTH = [
  { char: '\u200B', name: 'ZERO WIDTH SPACE' },
  { char: '\u200C', name: 'ZERO WIDTH NON-JOINER' },
  { char: '\u200D', name: 'ZERO WIDTH JOINER' },
  { char: '\uFEFF', name: 'ZERO WIDTH NO-BREAK SPACE' },
];

const MONEY_RE = /\$?\s*(-?[\d,]+\.\d{2})/;
const DATE_RE = /(\d{4}-\d{2}-\d{2})/;
const ITEM_CODE_RE = /\b(\d{2}_\d{3}_\d{4}_\d_\d)\b/;

/** PDF uses backslash escapes and octal codes inside literal strings. */
function unescapePdfLiteral(raw) {
  let out = '';
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    const next = raw[i + 1];
    if (next === undefined) break;
    if (next === 'n') { out += '\n'; i += 1; }
    else if (next === 'r') { out += '\r'; i += 1; }
    else if (next === 't') { out += '\t'; i += 1; }
    else if (next === 'b' || next === 'f') { i += 1; }
    else if (next >= '0' && next <= '7') {
      let oct = next;
      let j = i + 2;
      while (j < raw.length && oct.length < 3 && raw[j] >= '0' && raw[j] <= '7') {
        oct += raw[j];
        j += 1;
      }
      out += String.fromCharCode(parseInt(oct, 8));
      i = j - 1;
    } else {
      out += next;
      i += 1;
    }
  }
  return out;
}

/**
 * Pulls readable text out of a PDF.
 *
 * The invoice PDFs are produced by package:pdf with base-14 fonts, so the
 * glyph order lives in content streams as literal strings fed to Tj/TJ. There
 * is no PDF library available here and adding one is a bigger decision than
 * this feature warrants, so the streams are inflated and scraped directly.
 * That is enough for verification: we need the numbers back in reading order,
 * not a perfect layout model.
 */
function extractPdfText(buffer) {
  const chunks = [];
  // Latin1 first, so each byte is one character and the deflate payload is
  // preserved exactly. Executing a regex straight against the Buffer coerces it
  // as UTF-8, which mangles the binary and breaks the stream boundaries.
  const raw = buffer.toString('latin1');
  const streamRe = /stream\r?\n([\s\S]*?)endstream/g;
  let m;
  while ((m = streamRe.exec(raw)) !== null) {
    const streamRaw = m[1];
    let decoded;
    try {
      // FlateDecode is the common case. `streamRaw` is a latin1 string here, so
      // it must be converted back to bytes before inflating — handing zlib the
      // string directly re-encodes it as UTF-8 and silently corrupts the data.
      decoded = zlib.inflateSync(Buffer.from(streamRaw, 'latin1')).toString('latin1');
    } catch (e) {
      // Uncompressed streams, and images, carry no text we need.
      decoded = streamRaw;
    }
    chunks.push(decoded);
  }

  const textOps = [];
  for (const content of chunks) {
    // Show-text operators come in two flavours: a single literal string
    //   (...) Tj
    // and an array of literals plus kerning adjustments
    //   [ (a) -20 (b) ] TJ
    // The array form is handled by capturing everything between the brackets and
    // then lifting the literals out separately, which avoids a character class
    // broad enough to span the brackets themselves.
    const tjRe = /\(((?:[^()\\]|\\.)*)\)\s*Tj/g;
    let op;
    while ((op = tjRe.exec(content)) !== null) {
      textOps.push(unescapePdfLiteral(op[1]));
    }

    const arrayRe = /\[([\s\S]*?)\]\s*TJ/g;
    while ((op = arrayRe.exec(content)) !== null) {
      const parts = op[1].match(/\(((?:[^()\\]|\\.)*)\)/g) || [];
      parts.forEach((p) => {
        textOps.push(unescapePdfLiteral(p.slice(1, -1)));
      });
    }
  }
  // The content streams were decoded as latin1 to preserve the deflate payload
  // byte-for-byte. That means any multi-byte UTF-8 character — including the
  // zero-width watermark characters, which are how the hidden payload is
  // encoded — is currently sitting in the text as a run of latin1 bytes.
  // Re-decoding as UTF-8 turns those runs back into their real code points so
  // the watermark can be recognised at all.
  return Buffer.from(textOps.join(' '), 'latin1').toString('utf8');
}

/** Reports whether an invisible watermark payload is present, and how big. */
function inspectWatermark(text) {
  const found = {};
  for (const zw of ZERO_WIDTH) {
    const count = text.split(zw.char).length - 1;
    if (count > 0) found[zw.name] = count;
  }
  const total = Object.values(found).reduce((a, b) => a + b, 0);
  // The generator encodes a 64-char hex digest as 4 zero-width chars per hex
  // digit, so a payload of ~256 characters is the expected size.
  const payloadLength = total;
  return {
    present: total > 0,
    zeroWidthCharacters: total,
    byCharacter: found,
    expectedPayloadCharacters: 64 * 4,
    payloadLengthConsistent: payloadLength >= 64 * 3,
  };
}

function toNumber(s) {
  if (s === undefined || s === null) return null;
  const n = Number(String(s).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function findMoney(text, re) {
  const m = text.match(re);
  return m ? toNumber(m[1]) : null;
}

/**
 * Parses the line items out of the rendered invoice table.
 *
 * Segments are cut on the NDIS support item number because the surrounding
 * punctuation is inconsistent — the generator emits escaped parentheses and
 * variable spacing depending on which columns are populated — so matching the
 * whole row in one regex is brittle, while cutting on the item code is not.
 */
function parseLineItems(text) {
  // Item codes legitimately repeat — two shifts on the same support item is the
  // normal case — so positions are collected rather than a de-duplicated list.
  const positions = [];
  const codeRe = new RegExp(ITEM_CODE_RE.source, 'g');
  let cm;
  while ((cm = codeRe.exec(text)) !== null) {
    positions.push({ code: cm[1], index: cm.index });
  }

  const items = [];
  for (let i = 0; i < positions.length; i += 1) {
    const { code, index: start } = positions[i];
    const nextStart = i + 1 < positions.length ? positions[i + 1].index : -1;
    const noteAt = text.indexOf('Note:', start + 1);
    let end = text.length;
    if (nextStart > start) end = Math.min(end, nextStart);
    if (noteAt > start) end = Math.min(end, noteAt);

    const seg = text.slice(start, end).slice(0, 600);

    const hoursMatch = seg.match(/([\d.]+)\s*hours/);
    const dateMatch = seg.match(DATE_RE);
    const moneyMatches = seg.match(/\$\s*([\d,]+\.\d{2})/g) || [];
    const amounts = moneyMatches.map((s) => toNumber(s.replace('$', '')));

    // In the rendered row the money values appear as rate then row total.
    const rate = amounts.length >= 2 ? amounts[0] : null;
    const amount = amounts.length >= 2 ? amounts[amounts.length - 1] : null;

    items.push({
      supportItemNumber: code,
      date: dateMatch ? dateMatch[1] : null,
      hours: hoursMatch ? toNumber(hoursMatch[1]) : null,
      rate,
      totalPrice: amount,
    });
  }
  return items;
}

/** Parses the header and totals region of the invoice. */
function parseInvoiceFields(text) {
  return {
    invoiceNumber: (text.match(/Invoice Number:\s*([A-Za-z0-9\-_]+)/) || [])[1] || null,
    clientName: (text.match(/Client:\s*([^\n]+?)\s+ABN:/) || [])[1] || null,
    periodStart: (text.match(/Period Starting:\s*(\d{4}-\d{2}-\d{2})/) || [])[1] || null,
    periodEnd: (text.match(/Period Ending:\s*(\d{4}-\d{2}-\d{2})/) || [])[1] || null,
    totalAmount: findMoney(text, /Total Amount:\s*\$\s*([\d,]+\.\d{2})/),
    hoursCompleted: findMoney(text, /Hours Completed:\s*([\d.]+)/),
    subtotal: findMoney(text, /Subtotal\s*\$\s*([\d,]+\.\d{2})/),
    tax: findMoney(text, /Tax\s*\(\s*[\d.]+\s*%\s*\)?\s*\$\s*([\d,]+\.\d{2})/),
    total: findMoney(text, /Total\s*\$\s*([\d,]+\.\d{2})/),
    items: parseLineItems(text),
  };
}

/** Cent-tolerant comparison, since money is rounded independently at render. */
function moneyClose(a, b) {
  if (a === null || b === null || a === undefined || b === undefined) return false;
  return Math.abs(Number(a) - Number(b)) < 0.02;
}

function numClose(a, b, tol = 0.02) {
  if (a === null || a === undefined || b === null || b === undefined) return false;
  return Math.abs(Number(a) - Number(b)) <= tol;
}

/**
 * The check that actually catches an edited invoice.
 *
 * The watermark cannot do this, but the numbers can: if someone changes a line
 * item, the subtotal or the total by hand, the arithmetic no longer reconciles.
 * This needs no secret and no database, and it holds for a file that was never
 * ours to begin with.
 */
function checkArithmetic(fields) {
  const checks = [];

  const itemsSum = fields.items.reduce((a, i) => a + (i.totalPrice || 0), 0);
  checks.push({
    name: 'Line items sum to subtotal',
    expected: round2(fields.subtotal),
    actual: round2(itemsSum),
    passed: moneyClose(itemsSum, fields.subtotal),
    detail: `items ${round2(itemsSum)} vs subtotal ${round2(fields.subtotal)}`,
  });

  const itemsHours = fields.items.reduce((a, i) => a + (i.hours || 0), 0);
  checks.push({
    name: 'Line item hours sum to hours completed',
    expected: round2(fields.hoursCompleted),
    actual: round2(itemsHours),
    passed: numClose(itemsHours, fields.hoursCompleted),
    detail: `hours ${round2(itemsHours)} vs stated ${round2(fields.hoursCompleted)}`,
  });

  if (fields.tax !== null && fields.tax !== undefined) {
    const expectedTotal = round2((fields.subtotal || 0) + (fields.tax || 0));
    checks.push({
      name: 'Subtotal + tax equals total',
      expected: expectedTotal,
      actual: round2(fields.total),
      passed: moneyClose(expectedTotal, fields.total),
      detail: `${round2(fields.subtotal)} + ${round2(fields.tax)} vs ${round2(fields.total)}`,
    });
  }

  // Each row must internally reconcile: hours x rate = row amount.
  const badRows = fields.items.filter(
    (i) => i.hours !== null && i.rate !== null && i.totalPrice !== null
      && !moneyClose(i.hours * i.rate, i.totalPrice)
  );
  checks.push({
    name: 'Every line item reconciles (hours x rate = amount)',
    expected: 0,
    actual: badRows.length,
    passed: badRows.length === 0,
    detail: badRows.length
      ? `${badRows.length} row(s) do not reconcile`
      : 'all rows reconcile',
  });

  return checks;
}

function round2(n) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return null;
  return Math.round(Number(n) * 100) / 100;
}

/**
 * Compares an uploaded PDF against the invoice record the app actually issued.
 *
 * This is the meaningful integrity signal, because the database knows the truth
 * and the PDF is just a rendering of it. Any difference is either tampering or
 * a stale record, and the report says which fields moved.
 */
function compareToRecord(fields, invoice) {
  const diffs = [];
  const same = (label, a, b) => {
    if (a === null || a === undefined) {
      diffs.push({ field: label, pdf: null, stored: b, state: 'not-parsed' });
      return;
    }
    if (String(a) === String(b)) return;
    diffs.push({ field: label, pdf: a, stored: b, state: 'differs' });
  };

  same('invoiceNumber', fields.invoiceNumber, invoice.invoiceNumber);
  same('periodStart', fields.periodStart, invoice.startDate ? new Date(invoice.startDate).toISOString().slice(0, 10) : null);
  same('periodEnd', fields.periodEnd, invoice.endDate ? new Date(invoice.endDate).toISOString().slice(0, 10) : null);

  const fin = invoice.financialSummary || {};
  same('subtotal', fields.subtotal, fin.subtotal);
  same('tax', fields.tax, fin.taxAmount);
  same('total', fields.total, fin.totalAmount);

  // Line items are the substantive content: compare code, hours, rate, amount.
  const storedItems = (invoice.lineItems || []).map((li) => ({
    supportItemNumber: li.supportItemNumber,
    hours: li.quantity,
    rate: li.price,
    totalPrice: li.totalPrice,
  }));

  if (storedItems.length !== fields.items.length) {
    diffs.push({
      field: 'lineItemCount',
      pdf: fields.items.length,
      stored: storedItems.length,
      state: 'differs',
    });
  }

  const max = Math.max(storedItems.length, fields.items.length);
  for (let i = 0; i < max; i += 1) {
    const p = fields.items[i];
    const s = storedItems[i];
    if (!p || !s) {
      diffs.push({ field: `lineItem[${i}]`, pdf: p || null, stored: s || null, state: 'differs' });
      continue;
    }
    if (p.supportItemNumber !== s.supportItemNumber) {
      diffs.push({ field: `lineItem[${i}].code`, pdf: p.supportItemNumber, stored: s.supportItemNumber, state: 'differs' });
    }
    if (!numClose(p.hours, s.hours)) {
      diffs.push({ field: `lineItem[${i}].hours`, pdf: p.hours, stored: s.hours, state: 'differs' });
    }
    if (!moneyClose(p.rate, s.rate)) {
      diffs.push({ field: `lineItem[${i}].rate`, pdf: p.rate, stored: s.rate, state: 'differs' });
    }
    if (!moneyClose(p.totalPrice, s.totalPrice)) {
      diffs.push({ field: `lineItem[${i}].amount`, pdf: p.totalPrice, stored: s.totalPrice, state: 'differs' });
    }
  }

  const realDiffs = diffs.filter((d) => d.state === 'differs');
  return {
    matches: realDiffs.length === 0,
    diffs,
    realDiffCount: realDiffs.length,
    unparsedCount: diffs.filter((d) => d.state === 'not-parsed').length,
  };
}

/**
 * Produces a single verdict from the three independent signals, and says
 * plainly which of them can and cannot support a tampering conclusion.
 */
function buildVerdict({ arithmetic, record, watermark }) {
  const signals = [];

  if (!arithmetic.passed) {
    signals.push('arithmetic');
  }
  if (record.found && !record.matches) {
    signals.push('record-mismatch');
  }
  if (!watermark.present) {
    signals.push('no-watermark');
  }

  let verdict;
  let confidence;
  if (!arithmetic.passed) {
    // Broken arithmetic is the strongest signal, because it needs no secret and
    // no database: the document contradicts itself.
    verdict = 'modified';
    confidence = 'high';
  } else if (record.found && !record.matches) {
    verdict = 'differs-from-record';
    confidence = 'high';
  } else if (record.found) {
    verdict = watermark.present ? 'original' : 'consistent-with-record';
    confidence = 'high';
  } else {
    // Arithmetic is fine but there is nothing to compare against — either a
    // foreign invoice, or the invoice number could not be read. Claiming it
    // "matches the record" here would be a statement about a comparison that
    // never happened.
    verdict = 'self-consistent';
    confidence = 'medium';
  }

  return {
    verdict,
    confidence,
    signals,
    claims: {
      arithmeticSelfConsistent: arithmetic.passed,
      matchesStoredRecord: record.found ? record.matches : null,
      watermarkPresent: watermark.present,
      watermarkCryptographicallyVerified: false,
    },
  };
}

module.exports = {
  WATERMARK_LIMITS,
  extractPdfText,
  inspectWatermark,
  parseInvoiceFields,
  checkArithmetic,
  compareToRecord,
  buildVerdict,
};
