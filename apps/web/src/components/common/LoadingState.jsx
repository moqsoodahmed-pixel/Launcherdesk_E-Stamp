export default function LoadingState({ text = "Loading..." }) {
  return (
    <div role="status" aria-live="polite" className="py-10 text-center text-sm text-slate-500">
      <span className="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-brand-600 align-[-2px]" aria-hidden="true" />
      {text}
    </div>
  );
}
