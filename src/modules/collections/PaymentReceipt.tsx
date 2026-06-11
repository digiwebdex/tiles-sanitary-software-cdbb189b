import { forwardRef } from "react";
import { format } from "date-fns";

interface PaymentReceiptProps {
  dealerName: string;
  dealerPhone: string | null;
  dealerAddress: string | null;
  customerName: string;
  customerPhone: string | null;
  amount: number;
  note: string;
  date: string;
  receiptNo: string;
  remainingDue: number;
  paymentMethod?: string;
}

const PaymentReceipt = forwardRef<HTMLDivElement, PaymentReceiptProps>(
  ({ dealerName, dealerPhone, dealerAddress, customerName, customerPhone, amount, note, date, receiptNo, remainingDue, paymentMethod = "Cash" }, ref) => {
    return (
      <div ref={ref} className="p-8 max-w-md mx-auto bg-white text-black font-sans" style={{ fontFamily: "'Segoe UI', sans-serif" }}>
        {/* Header */}
        <div className="text-center border-b-2 border-black pb-3 mb-4">
          <h1 className="text-xl font-bold uppercase tracking-wide">{dealerName}</h1>
          {dealerAddress && <p className="text-xs mt-0.5">{dealerAddress}</p>}
          {dealerPhone && <p className="text-xs">Phone: {dealerPhone}</p>}
          <p className="text-sm font-semibold mt-2 bg-black text-white inline-block px-4 py-0.5 rounded-sm">
            PAYMENT RECEIPT
          </p>
        </div>

        {/* Receipt Info */}
        <div className="flex justify-between text-xs mb-4">
          <div>
            <p><span className="font-semibold">Receipt No:</span> {receiptNo}</p>
          </div>
          <div className="text-right">
            <p><span className="font-semibold">Date:</span> {format(new Date(date), "dd MMM yyyy")}</p>
          </div>
        </div>

        {/* Customer Info */}
        <div className="border border-gray-300 rounded p-3 mb-4 text-sm">
          <p className="font-semibold text-xs text-gray-500 uppercase mb-1">Received From</p>
          <p className="font-semibold">{customerName}</p>
          {customerPhone && <p className="text-xs text-gray-600">{customerPhone}</p>}
        </div>

        {/* Amount */}
        <div className="border-2 border-black rounded p-4 mb-4 text-center">
          <p className="text-xs text-gray-500 uppercase font-semibold">Amount Received</p>
          <p className="text-3xl font-bold mt-1">৳{amount.toLocaleString()}</p>
        </div>

        {/* Details */}
        <table className="w-full text-sm mb-4">
          <tbody>
            <tr className="border-b border-gray-200">
              <td className="py-1.5 text-gray-600">Payment Method</td>
              <td className="py-1.5 text-right font-medium">{paymentMethod}</td>
            </tr>
            {note && (
              <tr className="border-b border-gray-200">
                <td className="py-1.5 text-gray-600">Note</td>
                <td className="py-1.5 text-right font-medium">{note}</td>
              </tr>
            )}
            <tr className="border-b border-gray-200">
              <td className="py-1.5 text-gray-600">Remaining Due</td>
              <td className="py-1.5 text-right font-bold text-red-600">৳{remainingDue.toLocaleString()}</td>
            </tr>
          </tbody>
        </table>

        {/* Signature */}
        <div className="flex justify-between mt-10 pt-4 text-xs text-center">
          <div className="flex-1">
            <div className="border-t border-black mx-4 pt-1">Customer Signature</div>
          </div>
          <div className="flex-1">
            <div className="border-t border-black mx-4 pt-1">Authorized Signature</div>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-[10px] text-gray-400 mt-6">
          This is a computer-generated receipt. Thank you for your payment.
        </p>
      </div>
    );
  }
);

PaymentReceipt.displayName = "PaymentReceipt";
export default PaymentReceipt;
