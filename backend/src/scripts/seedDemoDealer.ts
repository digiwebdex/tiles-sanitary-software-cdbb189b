/**
 * Comprehensive demo data seed for dealer@tileserp.com
 *
 * Run on VPS:
 *   cd /var/www/tilessaas/backend
 *   npx ts-node src/scripts/seedDemoDealer.ts
 *
 * Idempotent-ish: it FIRST wipes prior demo transactional data
 * (sales, purchases, ledgers, etc.) for the demo dealer, then re-seeds.
 * Customers, suppliers, products are upserted by stable name/sku.
 *
 * Safe: only touches the demo dealer's rows (scoped by dealer_id).
 */
import { db } from '../db/connection';

const DEMO_EMAIL = process.env.DEMO_DEALER_EMAIL || 'dealer@tileserp.com';

type UUID = string;

const today = new Date();
const daysAgo = (n: number) => {
  const d = new Date(today);
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

async function getDemoDealerId(): Promise<UUID> {
  const profile = await db('profiles').where({ email: DEMO_EMAIL }).first();
  if (!profile?.dealer_id) {
    throw new Error(
      `Demo dealer profile not found for ${DEMO_EMAIL}. Make sure migration 014 has run and the user has a dealer.`,
    );
  }
  return profile.dealer_id as UUID;
}

async function ensureDemoFlag(dealerId: UUID) {
  await db('dealers').where({ id: dealerId }).update({ is_demo: true });
}

async function wipeDealerTransactional(dealerId: UUID) {
  // Order matters: children before parents.
  const tables = [
    'delivery_items',
    'deliveries',
    'challans',
    'sale_items',
    'customer_ledger',
    'sales_returns',
    'sales',
    'purchase_return_items',
    'purchase_returns',
    'purchase_items',
    'supplier_ledger',
    'purchases',
    'expense_ledger',
    'expenses',
    'cash_ledger',
    'stock',
  ];
  for (const t of tables) {
    try {
      await db(t).where({ dealer_id: dealerId }).delete();
    } catch (e: any) {
      console.warn(`  · skip wipe ${t}: ${e.message}`);
    }
  }
  // Optional newer tables (may or may not exist)
  for (const t of ['product_batches', 'stock_reservations', 'sale_batches', 'commission_sources', 'commissions', 'quotations', 'quotation_items', 'campaign_gifts']) {
    try {
      await db(t).where({ dealer_id: dealerId }).delete();
    } catch {}
  }
  console.log('  ✓ wiped prior demo transactional data');
}

async function upsertCustomers(dealerId: UUID) {
  const data = [
    { name: 'Rahim Construction Ltd.', type: 'project', phone: '01711000001', address: 'Gulshan-2, Dhaka', credit_limit: 500000, max_overdue_days: 45, opening_balance: 0 },
    { name: 'Karim Tiles House', type: 'retailer', phone: '01711000002', address: 'Mirpur-10, Dhaka', credit_limit: 300000, max_overdue_days: 30, opening_balance: 25000 },
    { name: 'Salam Brothers', type: 'retailer', phone: '01711000003', address: 'Chattogram', credit_limit: 200000, max_overdue_days: 30, opening_balance: 0 },
    { name: 'Mr. Abdullah (Walk-in)', type: 'customer', phone: '01711000004', address: 'Dhanmondi, Dhaka', credit_limit: 0, max_overdue_days: 0, opening_balance: 0 },
    { name: 'Mrs. Nasreen Ahmed', type: 'customer', phone: '01711000005', address: 'Uttara, Dhaka', credit_limit: 50000, max_overdue_days: 15, opening_balance: 0 },
    { name: 'Sky Builders Pvt.', type: 'project', phone: '01711000006', address: 'Bashundhara R/A', credit_limit: 800000, max_overdue_days: 60, opening_balance: 120000 },
    { name: 'Mim Decor Center', type: 'retailer', phone: '01711000007', address: 'Sylhet', credit_limit: 250000, max_overdue_days: 30, opening_balance: 0 },
    { name: 'Hossain Trading', type: 'retailer', phone: '01711000008', address: 'Khulna', credit_limit: 200000, max_overdue_days: 30, opening_balance: 15000 },
    { name: 'Mr. Faisal (Renovation)', type: 'customer', phone: '01711000009', address: 'Banani, Dhaka', credit_limit: 30000, max_overdue_days: 15, opening_balance: 0 },
    { name: 'Green Valley Apartments', type: 'project', phone: '01711000010', address: 'Purbachal', credit_limit: 1000000, max_overdue_days: 60, opening_balance: 0 },
    { name: 'Dream Home Decor', type: 'retailer', phone: '01711000011', address: 'Comilla', credit_limit: 150000, max_overdue_days: 30, opening_balance: 0 },
    { name: 'Mr. Tanvir', type: 'customer', phone: '01711000012', address: 'Mohammadpur', credit_limit: 0, max_overdue_days: 0, opening_balance: 0 },
  ];

  const ids: Record<string, UUID> = {};
  for (const c of data) {
    const existing = await db('customers').where({ dealer_id: dealerId, name: c.name }).first();
    if (existing) {
      await db('customers').where({ id: existing.id }).update({ ...c, status: 'active' });
      ids[c.name] = existing.id;
    } else {
      const [row] = await db('customers').insert({ dealer_id: dealerId, ...c, status: 'active' }).returning('id');
      ids[c.name] = row.id;
    }
    // opening balance ledger entry (clean and re-insert if needed)
    if (c.opening_balance > 0) {
      const has = await db('customer_ledger').where({ dealer_id: dealerId, customer_id: ids[c.name], type: 'opening_balance' }).first();
      if (!has) {
        await db('customer_ledger').insert({
          dealer_id: dealerId,
          customer_id: ids[c.name],
          type: 'opening_balance',
          amount: c.opening_balance,
          description: 'Opening balance',
          entry_date: daysAgo(120),
        });
      }
    }
  }
  console.log(`  ✓ ${data.length} customers ready`);
  return ids;
}

async function upsertSuppliers(dealerId: UUID) {
  const data = [
    { name: 'X-Tiles Ltd. (China)', contact_person: 'Mr. Liu', phone: '01911000001', email: 'liu@xtiles.cn', address: 'Foshan, China', opening_balance: 0 },
    { name: 'Akij Ceramics', contact_person: 'Mr. Karim', phone: '01911000002', email: 'sales@akij.com', address: 'Manikganj', opening_balance: 50000 },
    { name: 'RAK Ceramics', contact_person: 'Mr. Imran', phone: '01911000003', email: 'sales@rak.com.bd', address: 'Dhamrai', opening_balance: 0 },
    { name: 'DBL Ceramics', contact_person: 'Mr. Sajid', phone: '01911000004', email: 'sajid@dbl.com', address: 'Habiganj', opening_balance: 0 },
    { name: 'CWS Sanitary Mart', contact_person: 'Mr. Babul', phone: '01911000005', email: 'cws@mart.bd', address: 'Old Dhaka', opening_balance: 0 },
    { name: 'Star Ceramics', contact_person: 'Mr. Anis', phone: '01911000006', email: 'anis@star.bd', address: 'Gazipur', opening_balance: 25000 },
    { name: 'Greatwall Ceramic', contact_person: 'Mr. Wang', phone: '01911000007', email: 'wang@gw.cn', address: 'Guangzhou', opening_balance: 0 },
  ];
  const ids: Record<string, UUID> = {};
  for (const s of data) {
    const existing = await db('suppliers').where({ dealer_id: dealerId, name: s.name }).first();
    if (existing) {
      await db('suppliers').where({ id: existing.id }).update({ ...s, status: 'active' });
      ids[s.name] = existing.id;
    } else {
      const [row] = await db('suppliers').insert({ dealer_id: dealerId, ...s, status: 'active' }).returning('id');
      ids[s.name] = row.id;
    }
    if (s.opening_balance > 0) {
      const has = await db('supplier_ledger').where({ dealer_id: dealerId, supplier_id: ids[s.name], type: 'adjustment' }).where('description', 'like', 'Opening balance%').first();
      if (!has) {
        await db('supplier_ledger').insert({
          dealer_id: dealerId,
          supplier_id: ids[s.name],
          type: 'adjustment',
          amount: s.opening_balance,
          description: 'Opening balance',
          entry_date: daysAgo(120),
        });
      }
    }
  }
  console.log(`  ✓ ${data.length} suppliers ready`);
  return ids;
}

async function upsertProducts(dealerId: UUID) {
  const products = [
    // Tiles (box_sft)
    { sku: 'DEMO-T-6060-WHT', name: '600x600 Glossy White Floor Tile', category: 'tiles', unit_type: 'box_sft', per_box_sft: 15.5, cost_price: 950, default_sale_rate: 1200, size: '600x600 mm', color: 'White', brand: 'X-Tiles', material: 'Ceramic', warranty: '5 Years', weight: '32 kg', reorder_level: 50 },
    { sku: 'DEMO-T-6060-BEG', name: '600x600 Beige Marble Look', category: 'tiles', unit_type: 'box_sft', per_box_sft: 15.5, cost_price: 1100, default_sale_rate: 1450, size: '600x600 mm', color: 'Beige', brand: 'RAK', material: 'Porcelain', warranty: '7 Years', weight: '34 kg', reorder_level: 40 },
    { sku: 'DEMO-T-3060-GRY', name: '300x600 Wall Tile Grey', category: 'tiles', unit_type: 'box_sft', per_box_sft: 16.0, cost_price: 720, default_sale_rate: 950, size: '300x600 mm', color: 'Grey', brand: 'Akij', material: 'Ceramic', warranty: '3 Years', weight: '28 kg', reorder_level: 60 },
    { sku: 'DEMO-T-8080-MRB', name: '800x800 Carrara Marble', category: 'tiles', unit_type: 'box_sft', per_box_sft: 17.2, cost_price: 1850, default_sale_rate: 2400, size: '800x800 mm', color: 'White-Veined', brand: 'Greatwall', material: 'Vitrified', warranty: '10 Years', weight: '42 kg', reorder_level: 30 },
    { sku: 'DEMO-T-3030-MOS', name: '300x300 Mosaic Blue', category: 'tiles', unit_type: 'box_sft', per_box_sft: 11.0, cost_price: 1400, default_sale_rate: 1850, size: '300x300 mm', color: 'Blue', brand: 'Star', material: 'Glass Mosaic', warranty: '5 Years', weight: '18 kg', reorder_level: 25 },
    { sku: 'DEMO-T-6060-BLK', name: '600x600 Glossy Black', category: 'tiles', unit_type: 'box_sft', per_box_sft: 15.5, cost_price: 1050, default_sale_rate: 1350, size: '600x600 mm', color: 'Black', brand: 'DBL', material: 'Ceramic', warranty: '5 Years', weight: '32 kg', reorder_level: 35 },
    { sku: 'DEMO-T-3060-WD',  name: '300x600 Wood Grain', category: 'tiles', unit_type: 'box_sft', per_box_sft: 16.0, cost_price: 980, default_sale_rate: 1280, size: '300x600 mm', color: 'Walnut', brand: 'Akij', material: 'Porcelain', warranty: '7 Years', weight: '28 kg', reorder_level: 30 },
    { sku: 'DEMO-T-1212-OUT', name: '12x12 Outdoor Anti-Slip', category: 'tiles', unit_type: 'box_sft', per_box_sft: 12.0, cost_price: 880, default_sale_rate: 1150, size: '300x300 mm', color: 'Sand', brand: 'RAK', material: 'Ceramic', warranty: '5 Years', weight: '24 kg', reorder_level: 40 },

    // Sanitary (piece)
    { sku: 'DEMO-S-COMM-W',   name: 'Western Commode (One-Piece)',     category: 'sanitary', unit_type: 'piece', per_box_sft: null, cost_price: 6500, default_sale_rate: 8500, color: 'White', brand: 'RAK', material: 'Ceramic', warranty: '5 Years', weight: '38 kg', reorder_level: 8 },
    { sku: 'DEMO-S-BSN-W',    name: 'Wall-Hung Wash Basin',            category: 'sanitary', unit_type: 'piece', per_box_sft: null, cost_price: 1800, default_sale_rate: 2600, color: 'White', brand: 'CWS', material: 'Ceramic', warranty: '3 Years', weight: '15 kg', reorder_level: 12 },
    { sku: 'DEMO-S-MIX-CHR',  name: 'Bath Mixer Tap Chrome',           category: 'sanitary', unit_type: 'piece', per_box_sft: null, cost_price: 2200, default_sale_rate: 3200, color: 'Chrome', brand: 'CWS', material: 'Brass', warranty: '5 Years', weight: '1.5 kg', reorder_level: 15 },
    { sku: 'DEMO-S-SHWR-RND', name: 'Rain Shower Round 8"',            category: 'sanitary', unit_type: 'piece', per_box_sft: null, cost_price: 1400, default_sale_rate: 2100, color: 'Chrome', brand: 'CWS', material: 'SS', warranty: '3 Years', weight: '0.9 kg', reorder_level: 10 },
    { sku: 'DEMO-S-SINK-DBL', name: 'Kitchen Sink Double Bowl',        category: 'sanitary', unit_type: 'piece', per_box_sft: null, cost_price: 4800, default_sale_rate: 6500, color: 'Steel', brand: 'CWS', material: 'SS-304', warranty: '7 Years', weight: '8 kg', reorder_level: 6 },
    { sku: 'DEMO-S-FLUSH',    name: 'Concealed Flush Tank',            category: 'sanitary', unit_type: 'piece', per_box_sft: null, cost_price: 3200, default_sale_rate: 4500, color: 'White', brand: 'RAK', material: 'PP', warranty: '5 Years', weight: '6 kg', reorder_level: 8 },
  ];

  const ids: Record<string, UUID> = {};
  for (const p of products) {
    const existing = await db('products').where({ dealer_id: dealerId, sku: p.sku }).first();
    const payload = { ...p, dealer_id: dealerId, active: true } as any;
    if (existing) {
      await db('products').where({ id: existing.id }).update(payload);
      ids[p.sku] = existing.id;
    } else {
      const [row] = await db('products').insert(payload).returning('id');
      ids[p.sku] = row.id;
    }
  }
  console.log(`  ✓ ${products.length} products ready`);
  return { ids, products };
}

async function seedStock(dealerId: UUID, productIds: Record<string, UUID>, products: any[]) {
  for (const p of products) {
    const pid = productIds[p.sku];
    const isPiece = p.unit_type === 'piece';
    const stockQty = isPiece ? Math.floor(20 + Math.random() * 40) : 0;
    const boxQty = isPiece ? 0 : Math.floor(60 + Math.random() * 140);
    const sftQty = isPiece ? 0 : +(boxQty * (p.per_box_sft || 15)).toFixed(2);
    await db('stock').insert({
      dealer_id: dealerId,
      product_id: pid,
      box_qty: boxQty,
      sft_qty: sftQty,
      piece_qty: stockQty,
      reserved_box_qty: 0,
      reserved_piece_qty: 0,
      average_cost_per_unit: p.cost_price,
    }).onConflict(['dealer_id', 'product_id']).merge();
  }
  console.log(`  ✓ stock seeded`);
}

async function seedPurchases(dealerId: UUID, supplierIds: Record<string, UUID>, productIds: Record<string, UUID>, products: any[]) {
  const skus = Object.keys(productIds);
  const supplierNames = Object.keys(supplierIds);

  let invoiceCounter = 1001;
  for (let i = 0; i < 12; i++) {
    const supplierName = supplierNames[i % supplierNames.length];
    const supplierId = supplierIds[supplierName];
    const date = daysAgo(90 - i * 6);
    const numItems = 2 + Math.floor(Math.random() * 3);
    const pickedSkus: string[] = [];
    while (pickedSkus.length < numItems) {
      const s = skus[Math.floor(Math.random() * skus.length)];
      if (!pickedSkus.includes(s)) pickedSkus.push(s);
    }

    let total = 0;
    const items: any[] = [];
    for (const sku of pickedSkus) {
      const p = products.find((x) => x.sku === sku)!;
      const qty = p.unit_type === 'piece' ? 5 + Math.floor(Math.random() * 10) : 30 + Math.floor(Math.random() * 50);
      const rate = +(p.cost_price * (0.95 + Math.random() * 0.1)).toFixed(2);
      const lineTotal = +(qty * rate).toFixed(2);
      total += lineTotal;
      items.push({
        dealer_id: dealerId,
        product_id: productIds[sku],
        purchase_rate: rate,
        quantity: qty,
        total: lineTotal,
        total_sft: p.unit_type === 'box_sft' ? +(qty * (p.per_box_sft || 15)).toFixed(2) : null,
        transport_cost: 0,
        labor_cost: 0,
        other_cost: 0,
        landed_cost: rate,
        offer_price: +(rate * 1.25).toFixed(2),
      });
    }

    const [purchase] = await db('purchases').insert({
      dealer_id: dealerId,
      supplier_id: supplierId,
      invoice_number: `PINV-${invoiceCounter++}`,
      purchase_date: date,
      total_amount: +total.toFixed(2),
      notes: 'Demo purchase',
    }).returning('*');

    for (const it of items) {
      await db('purchase_items').insert({ purchase_id: purchase.id, ...it });
    }

    // supplier ledger debit (purchase increases supplier credit owed)
    await db('supplier_ledger').insert({
      dealer_id: dealerId,
      supplier_id: supplierId,
      purchase_id: purchase.id,
      type: 'purchase',
      amount: +total.toFixed(2),
      description: `Purchase ${purchase.invoice_number}`,
      entry_date: date,
    });

    // simulate partial payment (60% of purchases)
    if (i % 3 !== 0) {
      const paid = +(total * (0.5 + Math.random() * 0.5)).toFixed(2);
      await db('supplier_ledger').insert({
        dealer_id: dealerId,
        supplier_id: supplierId,
        purchase_id: purchase.id,
        type: 'payment',
        amount: paid,
        description: `Payment for ${purchase.invoice_number}`,
        entry_date: daysAgo(85 - i * 6),
      });
      await db('cash_ledger').insert({
        dealer_id: dealerId,
        type: 'payment',
        amount: paid,
        description: `Supplier payment - ${supplierName}`,
        reference_type: 'supplier_payment',
        reference_id: supplierId,
        entry_date: daysAgo(85 - i * 6),
      });
    }
  }
  console.log(`  ✓ 12 purchases seeded`);
}

async function seedSales(dealerId: UUID, customerIds: Record<string, UUID>, productIds: Record<string, UUID>, products: any[]) {
  const customers = Object.keys(customerIds);
  const skus = Object.keys(productIds);

  // Ensure invoice_sequences row
  await db('invoice_sequences').insert({ dealer_id: dealerId, next_invoice_no: 1, next_challan_no: 1 }).onConflict('dealer_id').ignore();

  let invNo = 1;
  let chNo = 1;

  for (let i = 0; i < 22; i++) {
    const customerName = customers[i % customers.length];
    const customerId = customerIds[customerName];
    const date = daysAgo(75 - i * 3);
    const numItems = 1 + Math.floor(Math.random() * 3);
    const picked: string[] = [];
    while (picked.length < numItems) {
      const s = skus[Math.floor(Math.random() * skus.length)];
      if (!picked.includes(s)) picked.push(s);
    }

    let total = 0;
    let cogs = 0;
    let totalBox = 0;
    let totalSft = 0;
    let totalPiece = 0;
    const items: any[] = [];
    for (const sku of picked) {
      const p = products.find((x) => x.sku === sku)!;
      const qty = p.unit_type === 'piece' ? 1 + Math.floor(Math.random() * 4) : 5 + Math.floor(Math.random() * 20);
      const rate = +(p.default_sale_rate * (0.92 + Math.random() * 0.12)).toFixed(2);
      const lineTotal = +(qty * rate).toFixed(2);
      const lineCogs = +(qty * p.cost_price).toFixed(2);
      total += lineTotal;
      cogs += lineCogs;
      if (p.unit_type === 'piece') totalPiece += qty;
      else {
        totalBox += qty;
        totalSft += qty * (p.per_box_sft || 15);
      }
      items.push({
        dealer_id: dealerId,
        product_id: productIds[sku],
        quantity: qty,
        sale_rate: rate,
        total: lineTotal,
        total_sft: p.unit_type === 'box_sft' ? +(qty * (p.per_box_sft || 15)).toFixed(2) : null,
      });
    }

    const discount = i % 4 === 0 ? +(total * 0.03).toFixed(2) : 0;
    const grandTotal = +(total - discount).toFixed(2);
    // payment status: 40% fully paid, 40% partial, 20% unpaid
    const r = Math.random();
    const paid = r < 0.4 ? grandTotal : r < 0.8 ? +(grandTotal * (0.3 + Math.random() * 0.5)).toFixed(2) : 0;
    const due = +(grandTotal - paid).toFixed(2);
    const profit = +(total - cogs - discount).toFixed(2);

    const invoiceNumber = `INV-${String(invNo++).padStart(5, '0')}`;

    const [sale] = await db('sales').insert({
      dealer_id: dealerId,
      customer_id: customerId,
      invoice_number: invoiceNumber,
      sale_date: date,
      sale_type: 'direct_invoice',
      sale_status: 'invoiced',
      total_amount: grandTotal,
      discount,
      paid_amount: paid,
      due_amount: due,
      cogs,
      profit,
      gross_profit: profit,
      net_profit: profit,
      total_box: totalBox,
      total_sft: +totalSft.toFixed(2),
      total_piece: totalPiece,
      payment_mode: paid > 0 ? (i % 2 === 0 ? 'cash' : 'bank') : null,
      notes: 'Demo sale',
    }).returning('*');

    for (const it of items) {
      await db('sale_items').insert({ sale_id: sale.id, ...it });
    }

    // customer ledger
    await db('customer_ledger').insert({
      dealer_id: dealerId,
      customer_id: customerId,
      sale_id: sale.id,
      type: 'sale',
      amount: grandTotal,
      description: `Sale ${invoiceNumber}`,
      entry_date: date,
    });
    if (paid > 0) {
      await db('customer_ledger').insert({
        dealer_id: dealerId,
        customer_id: customerId,
        sale_id: sale.id,
        type: 'payment',
        amount: paid,
        description: `Payment for ${invoiceNumber}`,
        entry_date: date,
      });
      await db('cash_ledger').insert({
        dealer_id: dealerId,
        type: 'receipt',
        amount: paid,
        description: `Sale receipt - ${invoiceNumber}`,
        reference_type: 'sale',
        reference_id: sale.id,
        entry_date: date,
      });
    }

    // 30% of sales get a challan
    if (i % 3 === 0) {
      await db('challans').insert({
        dealer_id: dealerId,
        sale_id: sale.id,
        challan_no: `CH-${String(chNo++).padStart(5, '0')}`,
        challan_date: date,
        status: i % 2 === 0 ? 'delivered' : 'pending',
        delivery_status: i % 2 === 0 ? 'delivered' : 'pending',
        show_price: false,
        driver_name: 'Mr. Jamal',
        transport_name: 'City Transport',
        vehicle_no: 'DHK-METRO-12-3456',
        notes: 'Demo challan',
      });
    }
  }

  // Update invoice sequences to next available
  await db('invoice_sequences').where({ dealer_id: dealerId }).update({
    next_invoice_no: invNo,
    next_challan_no: chNo,
  });
  console.log(`  ✓ 22 sales (with items, ledger, challans) seeded`);
}

async function seedExpenses(dealerId: UUID) {
  const expenses = [
    { description: 'Shop rent - October', amount: 35000, category: 'Rent' },
    { description: 'Electricity bill', amount: 8500, category: 'Utilities' },
    { description: 'Staff salary', amount: 65000, category: 'Salary' },
    { description: 'Transport - inbound', amount: 5200, category: 'Transport' },
    { description: 'Tea & snacks', amount: 1200, category: 'Office' },
    { description: 'Marketing flyers', amount: 4500, category: 'Marketing' },
    { description: 'Internet bill', amount: 1500, category: 'Utilities' },
  ];
  let i = 0;
  for (const e of expenses) {
    const [row] = await db('expenses').insert({
      dealer_id: dealerId,
      ...e,
      expense_date: daysAgo(60 - i * 7),
    }).returning('*');
    await db('expense_ledger').insert({
      dealer_id: dealerId,
      expense_id: row.id,
      amount: e.amount,
      description: e.description,
      category: e.category,
      entry_date: daysAgo(60 - i * 7),
    });
    await db('cash_ledger').insert({
      dealer_id: dealerId,
      type: 'expense',
      amount: e.amount,
      description: e.description,
      reference_type: 'expense',
      reference_id: row.id,
      entry_date: daysAgo(60 - i * 7),
    });
    i++;
  }
  console.log(`  ✓ ${expenses.length} expenses seeded`);
}

async function seedReturns(dealerId: UUID) {
  // 1 sales return + 1 purchase return for visibility
  const sale = await db('sales').where({ dealer_id: dealerId }).orderBy('sale_date', 'desc').first();
  if (sale) {
    const item = await db('sale_items').where({ sale_id: sale.id }).first();
    if (item) {
      await db('sales_returns').insert({
        dealer_id: dealerId,
        sale_id: sale.id,
        product_id: item.product_id,
        qty: Math.min(2, +item.quantity),
        reason: 'Customer found color mismatch',
        return_date: daysAgo(5),
        is_broken: false,
        refund_amount: +item.sale_rate * Math.min(2, +item.quantity),
        refund_mode: 'cash',
      });
    }
  }

  const purchase = await db('purchases').where({ dealer_id: dealerId }).orderBy('purchase_date', 'desc').first();
  if (purchase) {
    const pitem = await db('purchase_items').where({ purchase_id: purchase.id }).first();
    if (pitem) {
      const [pr] = await db('purchase_returns').insert({
        dealer_id: dealerId,
        supplier_id: purchase.supplier_id,
        purchase_id: purchase.id,
        return_no: `PR-0001`,
        return_date: daysAgo(8),
        status: 'completed',
        total_amount: +pitem.purchase_rate * 3,
        notes: 'Damaged on arrival',
      }).returning('*');
      await db('purchase_return_items').insert({
        purchase_return_id: pr.id,
        dealer_id: dealerId,
        product_id: pitem.product_id,
        quantity: 3,
        unit_price: pitem.purchase_rate,
        total: +pitem.purchase_rate * 3,
        reason: 'Broken',
      });
    }
  }
  console.log(`  ✓ sample returns seeded`);
}

async function main() {
  console.log(`\n🌱 Seeding demo data for ${DEMO_EMAIL} ...\n`);
  const dealerId = await getDemoDealerId();
  console.log(`  Demo dealer_id: ${dealerId}`);
  await ensureDemoFlag(dealerId);
  await wipeDealerTransactional(dealerId);

  const customerIds = await upsertCustomers(dealerId);
  const supplierIds = await upsertSuppliers(dealerId);
  const { ids: productIds, products } = await upsertProducts(dealerId);
  await seedStock(dealerId, productIds, products);
  await seedPurchases(dealerId, supplierIds, productIds, products);
  await seedSales(dealerId, customerIds, productIds, products);
  await seedExpenses(dealerId);
  await seedReturns(dealerId);

  console.log(`\n✅ Demo seed complete.\n`);
  await db.destroy();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('❌ Seed failed:', err);
  await db.destroy();
  process.exit(1);
});
