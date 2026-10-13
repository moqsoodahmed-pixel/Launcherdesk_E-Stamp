import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import Button from "./Button";

const FOCUSABLE = "a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])";

// Dialog with a focus trap, Escape to close and focus restored on close.
export default function Modal({ open = true, title, description, onClose, children, footer, size = "md", labelledBy, ariaLabel, bodyClassName = "overflow-y-auto px-5 py-4 sm:px-6", panelClassName = "" }) {
  const panelRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement;
    const panel = panelRef.current;
    const first = panel?.querySelector(FOCUSABLE);
    (first || panel)?.focus();
    function onKeyDown(e) {
      if (e.key === "Escape" && onCloseRef.current) {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const items = [...panel.querySelectorAll(FOCUSABLE)];
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (previous && typeof previous.focus === "function") previous.focus();
    };
  }, [open]);

  if (!open) return null;
  const width = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl" }[size] || "max-w-lg";
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-midnight-900/50" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabel ? undefined : labelledBy || (title ? titleId : undefined)}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={`relative flex max-h-[92dvh] w-full ${width} flex-col rounded-t-dialog bg-white shadow-overlay focus:outline-none sm:rounded-dialog ${panelClassName}`}
      >
        {(title || onClose) && (
          <div className="flex items-start justify-between gap-3 px-5 pb-1 pt-5 sm:px-6">
            <div className="min-w-0">
              {title && (
                <h2 id={titleId} className="font-display text-lg font-semibold text-slate-900">
                  {title}
                </h2>
              )}
              {description && (
                <p id={descId} className="mt-1 text-sm text-slate-600">
                  {description}
                </p>
              )}
            </div>
            {onClose && (
              <button type="button" onClick={onClose} className="-mr-2 -mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100" aria-label="Close">
                <X size={18} aria-hidden="true" />
              </button>
            )}
          </div>
        )}
        <div className={bodyClassName}>{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 px-5 py-4 sm:px-6">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmDialog({ open = true, title, message, confirmLabel = "Confirm", cancelLabel = "Go back", tone = "primary", busy = false, onConfirm, onCancel }) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant={tone === "danger" ? "danger" : "primary"} onClick={onConfirm} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {message && <p className="text-sm text-slate-700">{message}</p>}
    </Modal>
  );
}
