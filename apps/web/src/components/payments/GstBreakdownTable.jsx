import { formatCurrency } from "../../utils/format";

// Tax invoice line: the paid amount is GST-inclusive (18%), split into the
// taxable value and CGST/SGST at 9% each. Shared by both invoice views.
export default function GstBreakdownTable({ amount, description }) {
  const totalAmt = Number(amount) || 0;
  const taxableAmt = Math.round((totalAmt / 1.18) * 100) / 100;
  const totalGst = Math.round((totalAmt - taxableAmt) * 100) / 100;
  const cgst = Math.round((totalGst / 2) * 100) / 100;
  const sgst = Math.round((totalGst - cgst) * 100) / 100;
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full min-w-[520px] text-xs">
        <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
          <tr>
            <th scope="col" className="p-2.5 text-left font-semibold">Item & Description</th>
            <th scope="col" className="p-2.5 text-center font-semibold">SAC</th>
            <th scope="col" className="p-2.5 text-right font-semibold">Taxable Value</th>
            <th scope="col" className="p-2.5 text-right font-semibold">GST (18%)</th>
            <th scope="col" className="p-2.5 text-right font-semibold">Total Amount</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-slate-100">
            <td className="p-2.5 font-medium text-slate-800">{description}</td>
            <td className="p-2.5 text-center font-mono text-slate-600">998311</td>
            <td className="p-2.5 text-right text-slate-700 tabular-nums">{formatCurrency(taxableAmt)}</td>
            <td className="p-2.5 text-right text-slate-700 tabular-nums">{formatCurrency(totalGst)}</td>
            <td className="p-2.5 text-right font-medium text-slate-900 tabular-nums">{formatCurrency(totalAmt)}</td>
          </tr>
          <tr className="bg-slate-50/30 text-xs text-slate-600">
            <td colSpan={2} className="p-2 pl-2.5 tabular-nums">
              GST Split: CGST (9%): {formatCurrency(cgst)} | SGST (9%): {formatCurrency(sgst)}
            </td>
            <td colSpan={3} className="p-2 text-right">
              Tax included in final total
            </td>
          </tr>
        </tbody>
        <tfoot className="border-t border-slate-200 bg-slate-50/50 font-semibold">
          <tr>
            <td colSpan={4} className="p-2.5 text-slate-900">
              Total Paid (INR)
            </td>
            <td className="p-2.5 text-right text-sm text-slate-900 tabular-nums">{formatCurrency(totalAmt)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
