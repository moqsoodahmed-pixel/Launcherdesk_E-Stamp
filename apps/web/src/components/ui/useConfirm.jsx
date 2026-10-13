import { useCallback, useRef, useState } from "react";
import { ConfirmDialog } from "./Modal";

// Promise-based replacement for window.confirm:
//   const [confirm, confirmDialog] = useConfirm();
//   if (!(await confirm({ title, message, confirmLabel, tone }))) return;
//   ...render {confirmDialog} somewhere in the component.
// Resolves true on confirm, false on Go back, Escape, the close button or a
// backdrop click.
export function useConfirm() {
  const [request, setRequest] = useState(null);
  const resolveRef = useRef(null);

  const confirm = useCallback(
    (options) =>
      new Promise((resolve) => {
        resolveRef.current = resolve;
        setRequest(options);
      }),
    []
  );

  const settle = (value) => {
    const resolve = resolveRef.current;
    resolveRef.current = null;
    setRequest(null);
    resolve?.(value);
  };

  const dialog = request ? (
    <ConfirmDialog
      title={request.title}
      message={request.message}
      confirmLabel={request.confirmLabel}
      cancelLabel={request.cancelLabel}
      tone={request.tone}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  ) : null;

  return [confirm, dialog];
}

export default useConfirm;
