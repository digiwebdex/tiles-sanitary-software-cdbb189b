import writeXlsxFile from "write-excel-file";

interface ExportColumn {
  header: string;
  key: string;
  format?: "currency" | "number" | "percent" | "date";
}

function cellValue(row: Record<string, unknown>, col: ExportColumn): string | number | Date {
  const val = row[col.key];
  if (val === null || val === undefined) return "";
  if (col.format === "currency" || col.format === "number") return Number(val);
  if (col.format === "percent") return Number(val) / 100;
  if (col.format === "date" && val) return new Date(String(val));
  return String(val);
}

/**
 * Export data to Excel (.xlsx) and trigger download.
 * Uses write-excel-file (write-only) instead of the legacy xlsx package.
 */
export async function exportToExcelAsync<T extends object>(
  data: readonly T[],
  columns: ExportColumn[],
  filename: string,
) {
  if (data.length === 0) return;

  const schema = columns.map((col) => ({
    column: col.header,
    type: col.format === "date" ? Date : col.format === "number" || col.format === "currency" || col.format === "percent" ? Number : String,
    format: col.format === "currency" ? "#,##0.00" : undefined,
    value: (row: T) => cellValue(row as Record<string, unknown>, col),
  }));

  await writeXlsxFile(data as T[], {
    schema,
    fileName: `${filename}.xlsx`,
  });
}

/** Fire-and-forget wrapper — keeps existing sync call sites working. */
export function exportToExcel<T extends object>(
  data: readonly T[],
  columns: ExportColumn[],
  filename: string,
) {
  void exportToExcelAsync(data, columns, filename).catch((err) => {
    console.error("[exportToExcel]", err);
  });
}

// Common column definitions for reuse
export const commonColumns = {
  products: [
    { header: "SKU", key: "sku" },
    { header: "Name", key: "name" },
    { header: "Brand", key: "brand" },
    { header: "Category", key: "category" },
    { header: "Unit Type", key: "unitType" },
    { header: "Box Qty", key: "boxQty", format: "number" as const },
    { header: "SFT Qty", key: "sftQty", format: "number" as const },
    { header: "Piece Qty", key: "pieceQty", format: "number" as const },
    { header: "Avg Cost", key: "avgCost", format: "currency" as const },
    { header: "Stock Value", key: "stockValue", format: "currency" as const },
    { header: "Reorder Level", key: "reorderLevel", format: "number" as const },
  ],
  customers: [
    { header: "Name", key: "name" },
    { header: "Type", key: "type" },
    { header: "Phone", key: "phone" },
    { header: "Email", key: "email" },
    { header: "Address", key: "address" },
    { header: "Credit Limit", key: "credit_limit", format: "currency" as const },
    { header: "Opening Balance", key: "opening_balance", format: "currency" as const },
  ],
  suppliers: [
    { header: "Name", key: "name" },
    { header: "Phone", key: "phone" },
    { header: "Email", key: "email" },
    { header: "Contact Person", key: "contact_person" },
    { header: "GSTIN", key: "gstin" },
    { header: "Address", key: "address" },
    { header: "Opening Balance", key: "opening_balance", format: "currency" as const },
  ],
};
