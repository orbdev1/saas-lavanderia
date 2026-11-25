// Excel/LibreOffice can execute formulas even inside quoted CSV cells.
export function csvCell(value: unknown): string {
  let text = value == null ? '' : value instanceof Date ? value.toISOString() : String(value);
  if (/^[\s\uFEFF]*[=+\-@]/u.test(text) || /^[\t\r\n]/u.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function csvDocument(columns: string[], data: Record<string, unknown>[]): string {
  return '\uFEFF' + [
    columns.map(csvCell).join(','),
    ...data.map(row => columns.map(key => csvCell(row[key])).join(',')),
  ].join('\r\n');
}
