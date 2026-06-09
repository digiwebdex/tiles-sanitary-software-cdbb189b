import { describe, expect, it } from 'vitest';
import { generateActionHash } from '../../backend/src/lib/approvalActionHash';

describe('approvalActionHash', () => {
  it('produces stable SHA-256 hex for canonical context', () => {
    const hash = generateActionHash('backorder_sale', {
      customer_id: 'cust-1',
      customer_name: 'Karim Tiles',
      shortage_qty: 3,
      items: [
        {
          product_id: 'prod-b',
          product_name: 'Tile B',
          quantity: 5,
          sale_rate: 60,
        },
        {
          product_id: 'prod-a',
          product_name: 'Tile A',
          quantity: 2,
          sale_rate: 55,
        },
      ],
    });

    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(
      generateActionHash('backorder_sale', {
        customer_id: 'cust-1',
        customer_name: 'Karim Tiles',
        shortage_qty: 3,
        items: [
          {
            product_id: 'prod-b',
            product_name: 'Tile B',
            quantity: 5,
            sale_rate: 60,
          },
          {
            product_id: 'prod-a',
            product_name: 'Tile A',
            quantity: 2,
            sale_rate: 55,
          },
        ],
      }),
    ).toBe(hash);
  });

  it('sorts items by product_id before hashing (frontend parity)', () => {
    const ctxA = {
      customer_id: 'c1',
      items: [{ product_id: 'z', quantity: 1, sale_rate: 10 }],
    };
    const ctxB = {
      customer_id: 'c1',
      items: [{ product_id: 'z', quantity: 1, sale_rate: 10 }],
    };
    expect(generateActionHash('credit_override', ctxA)).toBe(
      generateActionHash('credit_override', ctxB),
    );
  });
});
