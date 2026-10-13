import Modal from "../ui/Modal";

// "Confirm Document Verification" dialog shared by the request and order
// detail pages. Presentational: the page owns the notes, busy state and the
// API call.
export default function VerifyDocumentsDialog({ request, notes, onNotesChange, verifying, onConfirm, onCancel }) {
  return (
    <Modal
      title="Confirm Document Verification"
      description={`Please verify that party names (${request?.firstParty} & ${request?.secondParty}), consideration value, and attached document descriptions are correct.`}
      onClose={verifying ? undefined : onCancel}
      footer={
        <>
          <button
            type="button"
            onClick={onCancel}
            disabled={verifying}
            className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 sm:min-h-[40px]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={verifying}
            className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-emerald-600 px-4 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 sm:min-h-[40px]"
          >
            {verifying ? "Confirming..." : "Confirm & Mark Verified"}
          </button>
        </>
      }
    >
      <label htmlFor="verify-notes" className="mb-1.5 block text-sm font-medium text-slate-800">
        Verification Notes (Optional)
      </label>
      <textarea
        id="verify-notes"
        value={notes}
        onChange={(e) => onNotesChange(e.target.value)}
        rows={3}
        placeholder="e.g. Identity and agreement documents verified against registry..."
        className="input min-h-[88px]"
      />
    </Modal>
  );
}
