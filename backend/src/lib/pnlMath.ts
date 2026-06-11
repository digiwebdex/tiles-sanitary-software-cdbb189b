/**
 * Pure P&L line math — shared contract for financials endpoint (Phase 7).
 */
export type PnlInput = {
  revenue: number;
  sales_returns: number;
  cogs: number;
  cogs_reversal: number;
};

export type PnlComputed = PnlInput & {
  net_revenue: number;
  net_cogs: number;
  gross_profit: number;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function computePnlLines(input: PnlInput): PnlComputed {
  const net_revenue = round2(input.revenue - input.sales_returns);
  const net_cogs = round2(input.cogs - input.cogs_reversal);
  const gross_profit = round2(net_revenue - net_cogs);
  return { ...input, net_revenue, net_cogs, gross_profit };
}

export function detectCogsDataQualityWarnings(input: PnlInput & { legacyPreFixCount?: number }): string[] {
  const warnings: string[] = [];
  const { net_cogs } = computePnlLines(input);

  if (input.cogs_reversal > input.cogs + 0.01) {
    warnings.push(
      'COGS reversal exceeds gross COGS for this period. Some sales returns may have missing cost reversal — profit may be overstated.',
    );
  }

  if (net_cogs < -0.01) {
    warnings.push(
      'Net COGS is negative after returns. Review sales return records and product average costs.',
    );
  }

  if (input.sales_returns > 0 && input.cogs_reversal <= 0.01 && input.cogs > 0) {
    warnings.push(
      'Sales returns were recorded without COGS reversal. Gross profit may not reflect returned inventory cost.',
    );
  }

  const computed = computePnlLines(input);
  const expectedGross = round2(input.revenue - input.sales_returns - net_cogs);
  if (Math.abs(computed.gross_profit - expectedGross) > 0.02) {
    warnings.push('P&L gross profit does not reconcile with revenue, returns, and net COGS.');
  }

  if ((input.legacyPreFixCount ?? 0) > 0) {
    warnings.push(
      `${input.legacyPreFixCount} sale(s) in this period use legacy tile COGS (pre Phase 1A fix). Profit may be overstated for those rows.`,
    );
  }

  return warnings;
}
