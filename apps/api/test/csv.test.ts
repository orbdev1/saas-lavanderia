import { describe, expect, it } from 'vitest';
import { csvCell, csvDocument } from '../src/csv.js';

describe('exportaciones CSV', () => {
  it('neutraliza fórmulas incluso con espacios o controles iniciales', () => {
    for (const value of ['=1+1', '+51999999999', '-1+1', '@SUM(A1)', '  =HYPERLINK("x")', '\t=1', '\rtexto']) {
      expect(csvCell(value).startsWith('"\'')).toBe(true);
    }
  });
  it('conserva comas, saltos, comillas y texto peruano en campos delimitados', () => {
    expect(csvCell('María, "Pérez"\nLima')).toBe('"María, ""Pérez""\nLima"');
    expect(csvDocument(['nombre', 'notas'], [{ nombre: 'José', notas: null }])).toBe('\uFEFF"nombre","notas"\r\n"José",""');
  });
});
