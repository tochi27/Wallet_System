import PDFDocument from "pdfkit";
import { Prisma, TransactionType } from "@prisma/client";
import type { Writable } from "stream";
import type { Statement } from "./statement.service";

// ── Formatting ──────────────────────────────────────────────────────────────

// Amounts without a symbol; column headers say "(NGN)". The PDF's built-in fonts have no ₦ glyph.
const amountFormat = new Intl.NumberFormat("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (value: Prisma.Decimal) => amountFormat.format(Number(value));

const dateTime = (date: Date, timezone: string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);

const longDate = (isoDate: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${isoDate}T00:00:00Z`)
  );

export const statementFilename = (statement: Statement, extension: "csv" | "pdf") =>
  `purplewallet-statement-${statement.from}-to-${statement.to}.${extension}`;

// ── CSV ─────────────────────────────────────────────────────────────────────

// Spreadsheet apps execute cells starting with these characters as formulas, and descriptions
// are typed by users, so such cells are prefixed with an apostrophe (CSV/formula injection)
const FORMULA_START = /^[=+\-@\t\r]/;

const csvCell = (value: string) => {
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
};

export const renderStatementCsv = (statement: Statement): string => {
  const header = ["Date", "Reference", "Description", "Money in (NGN)", "Money out (NGN)", "Balance (NGN)"];
  const lines = [
    header.map(csvCell).join(","),
    ...statement.rows.map((row) => {
      const isCredit = row.type === TransactionType.CREDIT;
      return [
        dateTime(row.date, statement.timezone),
        row.reference,
        row.description,
        isCredit ? row.amount.toFixed(2) : "",
        isCredit ? "" : row.amount.toFixed(2),
        row.balance.toFixed(2),
      ]
        .map(csvCell)
        .join(",");
    }),
  ];
  // Byte-order mark so Excel opens it as UTF-8
  return `﻿${lines.join("\r\n")}\r\n`;
};

// ── PDF ─────────────────────────────────────────────────────────────────────

const VIOLET = "#6d4aff";
const INK = "#16131f";
const MUTED = "#6b6880";
const RULE = "#e8e5f5";
const ZEBRA = "#f7f6fd";

// The built-in Helvetica only covers Latin-1; keep descriptions printable
const printable = (text: string) => text.replace(/•/g, "*").replace(/[^\x20-\x7E -ÿ]/g, "?");

const COLUMNS = [
  { key: "date", label: "Date", width: 92, align: "left" as const },
  { key: "description", label: "Description", width: 165, align: "left" as const },
  { key: "reference", label: "Reference", width: 62, align: "left" as const },
  { key: "in", label: "Money in", width: 60, align: "right" as const },
  { key: "out", label: "Money out", width: 60, align: "right" as const },
  { key: "balance", label: "Balance", width: 60, align: "right" as const },
];

/** Streams a branded A4 statement into `output` (e.g. the HTTP response). */
export const renderStatementPdf = (statement: Statement, output: Writable): void => {
  const doc = new PDFDocument({ size: "A4", margin: 48, bufferPages: true, info: { Title: "PurpleWallet statement" } });
  doc.pipe(output);
  const left = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  // Header
  // Wordmark: "Purple" in violet, "Wallet" in ink, as in the app
  doc.fillColor(VIOLET).font("Helvetica-Bold").fontSize(18).text("Purple", left, 48, { continued: true });
  doc.fillColor(INK).text("Wallet");
  doc.fillColor(INK).fontSize(14).text("Account statement", left, 76);
  doc
    .font("Helvetica")
    .fontSize(9)
    .fillColor(MUTED)
    .text(`${longDate(statement.from)} - ${longDate(statement.to)}  ·  Times in ${statement.timezone}`, left, 96);
  doc
    .fillColor(INK)
    .fontSize(10)
    .text(printable(statement.holder.name), left, 48, { width, align: "right" })
    .fillColor(MUTED)
    .fontSize(9)
    .text(printable(statement.holder.email), { width, align: "right" })
    .text(`Generated ${dateTime(statement.generatedAt, statement.timezone)}`, { width, align: "right" });

  // Summary boxes
  const summary = [
    ["Opening balance", statement.openingBalance],
    ["Money in", statement.moneyIn],
    ["Money out", statement.moneyOut],
    ["Closing balance", statement.closingBalance],
  ] as const;
  const boxWidth = (width - 3 * 8) / 4;
  const boxTop = 122;
  summary.forEach(([label, value], i) => {
    const x = left + i * (boxWidth + 8);
    doc.roundedRect(x, boxTop, boxWidth, 46, 6).fill(ZEBRA);
    doc.fillColor(MUTED).font("Helvetica").fontSize(8).text(label, x + 10, boxTop + 9, { width: boxWidth - 20 });
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(11).text(`NGN ${money(value)}`, x + 10, boxTop + 24, { width: boxWidth - 20 });
  });

  // Table
  const rowHeight = 20;
  const bottom = doc.page.height - doc.page.margins.bottom - 24;
  let y = boxTop + 66;

  const drawHeader = () => {
    let x = left;
    doc.font("Helvetica-Bold").fontSize(8).fillColor(MUTED);
    for (const column of COLUMNS) {
      doc.text(column.label, x + 4, y + 6, { width: column.width - 8, align: column.align });
      x += column.width;
    }
    doc.moveTo(left, y + rowHeight).lineTo(left + width, y + rowHeight).strokeColor(RULE).lineWidth(1).stroke();
    y += rowHeight;
  };

  drawHeader();
  if (statement.rows.length === 0) {
    doc.font("Helvetica").fontSize(9).fillColor(MUTED).text("No transactions in this period.", left, y + 10);
  }

  statement.rows.forEach((row, index) => {
    if (y + rowHeight > bottom) {
      doc.addPage();
      y = doc.page.margins.top;
      drawHeader();
    }
    if (index % 2 === 1) doc.rect(left, y, width, rowHeight).fill(ZEBRA);

    const isCredit = row.type === TransactionType.CREDIT;
    const cells: Record<string, string> = {
      date: dateTime(row.date, statement.timezone),
      description: printable(row.description),
      reference: row.reference.slice(0, 8).toUpperCase(),
      in: isCredit ? money(row.amount) : "",
      out: isCredit ? "" : money(row.amount),
      balance: money(row.balance),
    };
    let x = left;
    doc.font("Helvetica").fontSize(8).fillColor(INK);
    for (const column of COLUMNS) {
      doc.text(cells[column.key], x + 4, y + 6, {
        width: column.width - 8,
        align: column.align,
        lineBreak: false,
        ellipsis: true,
        height: rowHeight - 6,
      });
      x += column.width;
    }
    y += rowHeight;
  });

  // Footer on every page. pdfkit starts a new page when text goes past the bottom margin, so the
  // margin is lifted while the footer (which sits inside it) is drawn.
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const bottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const footerY = doc.page.height - bottomMargin + 16;
    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor(MUTED)
      .text("Amounts in Nigerian naira (NGN). Includes completed and reversed transactions.", left, footerY, {
        width: width - 60,
        lineBreak: false,
      })
      .text(`Page ${i - range.start + 1} of ${range.count}`, left, footerY, { width, align: "right", lineBreak: false });
    doc.page.margins.bottom = bottomMargin;
  }

  doc.end();
};
