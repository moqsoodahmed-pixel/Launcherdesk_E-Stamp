import { AlertCircle } from "lucide-react";

export default function ErrorState({ message = "Something went wrong.", onRetry }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-vermilion-200 bg-vermilion-50 px-3 py-2.5 text-sm text-vermilion-800">
      <span className="flex min-w-0 items-start gap-2">
        <AlertCircle size={18} className="mt-px shrink-0" aria-hidden="true" />
        <span>{message}</span>
      </span>
      {onRetry && (
        <button type="button" onClick={onRetry} className="min-h-[36px] rounded-lg border border-vermilion-200 bg-white px-3 text-xs font-medium text-vermilion-700 hover:bg-vermilion-100">
          Retry
        </button>
      )}
    </div>
  );
}
