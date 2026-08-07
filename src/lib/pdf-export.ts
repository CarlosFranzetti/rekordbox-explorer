import type { Track } from '@/types/rekordbox';
import { APP_NAME } from '@/lib/version';
import { safeFileName } from '@/lib/usb/fs';
import {
  DEFAULT_EXPORT_COLUMNS,
  EXPORT_COLUMN_LABEL,
  cellValue,
  type ExportColumn,
} from '@/lib/export/exporters';

export interface PdfExportOptions {
  columns?: ExportColumn[];
  pageSize?: 'a4' | 'letter';
  orientation?: 'portrait' | 'landscape';
  includeNumbers?: boolean;
  includeFooter?: boolean;
  /** Base font size for table body text. */
  fontSize?: number;
}

/** Widths that keep the common columns readable instead of evenly squashed. */
const COLUMN_WIDTH: Partial<Record<ExportColumn, number>> = {
  bpm: 14,
  key: 14,
  year: 14,
  duration: 18,
  rating: 14,
  bitrate: 20,
};

/**
 * jsPDF and its dependencies are ~400 KB — a third of the whole bundle — and
 * most sessions never export a PDF. Load it on demand instead.
 */
export async function exportTracksToPdf(
  tracks: Track[],
  playlistName: string,
  options: PdfExportOptions = {}
): Promise<void> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);

  const columns = options.columns?.length ? options.columns : DEFAULT_EXPORT_COLUMNS;
  const orientation = options.orientation ?? 'portrait';
  const fontSize = options.fontSize ?? 8;

  const doc = new jsPDF({ orientation, unit: 'mm', format: options.pageSize ?? 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setFontSize(16);
  doc.text(playlistName, 14, 18);

  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(
    `${tracks.length} track${tracks.length === 1 ? '' : 's'} · ${new Date().toLocaleString()}`,
    14,
    24
  );
  doc.setTextColor(0);

  const head = [
    [
      ...(options.includeNumbers === false ? [] : ['#']),
      ...columns.map((column) => EXPORT_COLUMN_LABEL[column]),
    ],
  ];

  const body = tracks.map((track, index) => [
    ...(options.includeNumbers === false ? [] : [String(index + 1)]),
    ...columns.map((column) => cellValue(track, column)),
  ]);

  const columnStyles: Record<number, { cellWidth: number }> = {};
  const offset = options.includeNumbers === false ? 0 : 1;
  if (offset) columnStyles[0] = { cellWidth: 10 };
  columns.forEach((column, i) => {
    const width = COLUMN_WIDTH[column];
    if (width) columnStyles[i + offset] = { cellWidth: width };
  });

  autoTable(doc, {
    head,
    body,
    startY: 29,
    styles: { fontSize, cellPadding: 1.5, overflow: 'ellipsize' },
    headStyles: { fillColor: [41, 128, 185], fontSize: fontSize + 0.5 },
    alternateRowStyles: { fillColor: [246, 246, 248] },
    columnStyles,
    margin: { left: 14, right: 14 },
    didDrawPage: () => {
      if (options.includeFooter === false) return;
      const pageHeight = doc.internal.pageSize.getHeight();
      doc.setFontSize(7);
      doc.setTextColor(150);
      doc.text(APP_NAME, 14, pageHeight - 8);
      doc.text(
        `Page ${doc.getNumberOfPages()}`,
        pageWidth - 14,
        pageHeight - 8,
        { align: 'right' }
      );
      doc.setTextColor(0);
    },
  });

  doc.save(`${safeFileName(playlistName, 'playlist')}.pdf`);
}

/** Open the browser print dialog with a clean, printable table. */
export function printTracks(
  tracks: Track[],
  playlistName: string,
  columns: ExportColumn[] = DEFAULT_EXPORT_COLUMNS
): void {
  const escape = (value: string) =>
    value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const rows = tracks
    .map(
      (track, index) =>
        `<tr><td class="n">${index + 1}</td>${columns
          .map((column) => `<td>${escape(cellValue(track, column))}</td>`)
          .join('')}</tr>`
    )
    .join('');

  const html = `<!doctype html><html><head><meta charset="utf-8">
<title>${escape(playlistName)}</title>
<style>
  body { font: 11px/1.4 system-ui, sans-serif; margin: 24px; color: #111; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  p.meta { color: #666; margin: 0 0 16px; font-size: 11px; }
  table { border-collapse: collapse; width: 100%; }
  th { text-align: left; background: #2980b9; color: #fff; padding: 5px 6px; font-size: 11px; }
  td { padding: 4px 6px; border-bottom: 1px solid #e3e3e6; }
  td.n { color: #888; text-align: right; width: 32px; }
  tr:nth-child(even) td { background: #f7f7f9; }
  @media print { body { margin: 0; } th { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style></head><body>
<h1>${escape(playlistName)}</h1>
<p class="meta">${tracks.length} track${tracks.length === 1 ? '' : 's'} · ${escape(
    new Date().toLocaleString()
  )}</p>
<table><thead><tr><th></th>${columns
    .map((column) => `<th>${escape(EXPORT_COLUMN_LABEL[column])}</th>`)
    .join('')}</tr></thead><tbody>${rows}</tbody></table>
</body></html>`;

  const printWindow = window.open('', '_blank', 'noopener,noreferrer');
  if (!printWindow) {
    throw new Error('Your browser blocked the print window. Allow pop-ups for this site.');
  }
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
}
