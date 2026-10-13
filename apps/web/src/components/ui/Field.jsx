import { forwardRef, useId } from "react";

// Label + control + hint/error. `children` may be a render function that
// receives { id, aria-describedby, aria-invalid } to spread onto the control.
export function Field({ label, hint, error, required, id, children, className = "" }) {
  const autoId = useId();
  const fieldId = id || autoId;
  const hintId = hint ? `${fieldId}-hint` : undefined;
  const errorId = error ? `${fieldId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  const control = typeof children === "function" ? children({ id: fieldId, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined }) : children;
  return (
    <div className={className}>
      {label && (
        <label htmlFor={fieldId} className="mb-1.5 block text-sm font-medium text-slate-800">
          {label}
          {required && (
            <span className="ml-0.5 text-vermilion-600" aria-hidden="true">
              *
            </span>
          )}
        </label>
      )}
      {control}
      {hint && !error && (
        <p id={hintId} className="mt-1 text-xs text-slate-500">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="mt-1 text-xs text-vermilion-700">
          {error}
        </p>
      )}
    </div>
  );
}

export const Input = forwardRef(function Input({ className = "", ...rest }, ref) {
  return <input ref={ref} className={`input ${className}`} {...rest} />;
});

export const Select = forwardRef(function Select({ className = "", children, ...rest }, ref) {
  return (
    <select ref={ref} className={`input pr-8 ${className}`} {...rest}>
      {children}
    </select>
  );
});

export const Textarea = forwardRef(function Textarea({ className = "", rows = 3, ...rest }, ref) {
  return <textarea ref={ref} rows={rows} className={`input min-h-[88px] ${className}`} {...rest} />;
});

export default Field;
