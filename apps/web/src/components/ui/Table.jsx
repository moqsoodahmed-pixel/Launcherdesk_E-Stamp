// Horizontal-scroll wrapper + table with a sticky header and hover rows. The
// wrapper is the table's direct parent (tests rely on that).
export function Table({ children, className = "", wrapperClassName = "", maxHeight, ...rest }) {
  return (
    <div className={`overflow-x-auto ${maxHeight ? "overflow-y-auto" : ""} ${wrapperClassName}`} style={maxHeight ? { maxHeight } : undefined}>
      <table className={`ui-table w-full text-sm ${className}`} {...rest}>
        {children}
      </table>
    </div>
  );
}

const ALIGN = { left: "text-left", right: "text-right", center: "text-center" };

export function Th({ children, className = "", align = "left", ...rest }) {
  return (
    <th scope="col" className={`sticky top-0 z-[1] whitespace-nowrap border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-xs font-semibold text-slate-600 ${ALIGN[align]} ${className}`} {...rest}>
      {children}
    </th>
  );
}

export function Td({ children, className = "", align = "left", ...rest }) {
  return (
    <td className={`border-b border-slate-100 px-4 py-3 text-slate-700 ${ALIGN[align]} ${className}`} {...rest}>
      {children}
    </td>
  );
}

export function Tr({ children, className = "", ...rest }) {
  return (
    <tr className={`transition-colors hover:bg-brand-50/40 ${className}`} {...rest}>
      {children}
    </tr>
  );
}

export default Table;
