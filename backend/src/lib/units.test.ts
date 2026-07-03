import { describe, expect, it } from 'vitest';
import {
  formatBoxPiece,
  fromTotalPieces,
  normalizeBoxPiece,
  toTotalPieces,
} from './units';

describe('units', () => {
  it('toTotalPieces converts box + piece', () => {
    expect(toTotalPieces({ box: 2, piece: 3 }, 12)).toBe(27);
  });

  it('fromTotalPieces splits into box and piece', () => {
    expect(fromTotalPieces(27, 12)).toEqual({ box: 2, piece: 3 });
  });

  it('normalizeBoxPiece carries overflow pieces into boxes', () => {
    expect(normalizeBoxPiece({ box: 1, piece: 15 }, 12)).toEqual({ box: 2, piece: 3 });
  });

  it('formatBoxPiece renders display string', () => {
    expect(formatBoxPiece(27, 12)).toBe('2 box 3 pcs');
  });
});
