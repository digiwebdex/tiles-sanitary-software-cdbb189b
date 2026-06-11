/**
 * Convert BDT amount to words (English) for tax invoice footers.
 */
const ONES = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function under1000(n: number): string {
  if (n === 0) return "";
  if (n < 20) return ONES[n];
  if (n < 100) {
    const t = Math.floor(n / 10);
    const r = n % 10;
    return r ? `${TENS[t]} ${ONES[r]}`.trim() : TENS[t];
  }
  const h = Math.floor(n / 100);
  const r = n % 100;
  return r ? `${ONES[h]} Hundred ${under1000(r)}`.trim() : `${ONES[h]} Hundred`;
}

function integerToWords(n: number): string {
  if (n === 0) return "Zero";
  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n % 10000000) / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const rest = n % 1000;
  const parts: string[] = [];
  if (crore) parts.push(`${under1000(crore)} Crore`);
  if (lakh) parts.push(`${under1000(lakh)} Lakh`);
  if (thousand) parts.push(`${under1000(thousand)} Thousand`);
  if (rest) parts.push(under1000(rest));
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

/** e.g. 1150.50 → "One Thousand One Hundred Fifty Taka and Fifty Paisa Only" */
export function amountInWordsBdt(amount: number): string {
  const safe = Math.max(0, Number(amount) || 0);
  const taka = Math.floor(safe);
  const paisa = Math.round((safe - taka) * 100);
  let words = `${integerToWords(taka)} Taka`;
  if (paisa > 0) {
    words += ` and ${integerToWords(paisa)} Paisa`;
  }
  return `${words} Only`;
}
