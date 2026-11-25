import { useState } from 'react';
import { flexRender, getCoreRowModel, getPaginationRowModel, getSortedRowModel, useReactTable, type ColumnDef, type SortingState } from '@tanstack/react-table';
import { Button } from './ui/button';

export function DataTable<T>({ rows, columns, label }: { rows: T[]; columns: ColumnDef<T>[]; label: string }) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const table = useReactTable({ data: rows, columns, state: { sorting }, onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(), getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 20 } } });
  return <><div className="panel table-wrap"><table aria-label={label}>
    <thead>{table.getHeaderGroups().map(group => <tr key={group.id}>{group.headers.map(header => <th key={header.id} aria-sort={header.column.getIsSorted() === 'asc' ? 'ascending' : header.column.getIsSorted() === 'desc' ? 'descending' : undefined}>
      {header.isPlaceholder ? null : header.column.getCanSort() ? <button className="table-sort" onClick={header.column.getToggleSortingHandler()}>{flexRender(header.column.columnDef.header, header.getContext())} {header.column.getIsSorted() === 'asc' ? '↑' : header.column.getIsSorted() === 'desc' ? '↓' : '↕'}</button> : flexRender(header.column.columnDef.header, header.getContext())}
    </th>)}</tr>)}</thead>
    <tbody>{table.getRowModel().rows.map(row => <tr key={row.id}>{row.getVisibleCells().map(cell => <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>)}</tr>)}</tbody>
    </table>{rows.length === 0 && <p className="empty">Sin registros.</p>}</div>
    {rows.length > 20 && <div className="pagination"><Button variant="outline" disabled={!table.getCanPreviousPage()} onClick={() => table.previousPage()}>Anterior</Button><span>Página {table.getState().pagination.pageIndex + 1} de {table.getPageCount()}</span><Button variant="outline" disabled={!table.getCanNextPage()} onClick={() => table.nextPage()}>Siguiente</Button></div>}
  </>;
}
