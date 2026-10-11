export default function ErrorState({ message = "Something went wrong.", onRetry }) {
  return (
    <div role="alert" className="rounded-lg bg-red-50 text-red-700 text-sm px-3 py-3 flex flex-wrap items-center justify-between gap-2">
      <span>{message}</span>
      {onRetry && (
        <button type="button" onClick={onRetry} className="rounded-lg border border-red-200 bg-white px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-100">
          Retry
        </button>
      )}
    </div>
  );
}
