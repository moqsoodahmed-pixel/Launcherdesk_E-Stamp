export default function LoadingState({ text = "Loading..." }) {
  return (
    <div role="status" aria-live="polite" className="py-10 text-center text-sm text-slate-500">
      <span className="inline-block h-4 w-4 mr-2 align-[-2px] rounded-full border-2 border-slate-300 border-t-brand-600 animate-spin" aria-hidden="true" />
      {text}
    </div>
  );
}
