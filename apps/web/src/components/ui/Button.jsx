import { forwardRef } from "react";
import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";

const VARIANTS = {
  primary: "bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800 disabled:bg-brand-300",
  secondary: "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 hover:border-slate-400 active:bg-slate-100 disabled:text-slate-400",
  ghost: "text-slate-700 hover:bg-slate-100 active:bg-slate-200 disabled:text-slate-400",
  danger: "bg-vermilion-600 text-white hover:bg-vermilion-700 active:bg-vermilion-800 disabled:bg-vermilion-300",
  accent: "bg-marigold-400 text-ink hover:bg-marigold-300 active:bg-marigold-500 disabled:opacity-60",
};
const SIZES = {
  sm: "min-h-[36px] px-3 text-xs gap-1.5",
  md: "min-h-[44px] sm:min-h-[40px] px-4 text-sm gap-2",
  lg: "min-h-[48px] px-5 text-base gap-2",
};

export function buttonClasses({ variant = "primary", size = "md", className = "" } = {}) {
  return `inline-flex items-center justify-center rounded-lg font-medium transition-colors disabled:cursor-not-allowed ${VARIANTS[variant] || VARIANTS.primary} ${SIZES[size] || SIZES.md} ${className}`;
}

// <Button>, or a router link styled as one with `to`, or an anchor with `href`.
const Button = forwardRef(function Button({ variant, size, loading = false, icon: IconCmp, iconRight: IconRight, to, href, className, children, disabled, type = "button", ...rest }, ref) {
  const cls = buttonClasses({ variant, size, className });
  const iconSize = size === "sm" ? 14 : 16;
  const content = (
    <>
      {loading ? <Loader2 size={iconSize} className="animate-spin" aria-hidden="true" /> : IconCmp ? <IconCmp size={iconSize} aria-hidden="true" /> : null}
      {children}
      {IconRight && !loading ? <IconRight size={iconSize} aria-hidden="true" /> : null}
    </>
  );
  if (to) {
    return (
      <Link ref={ref} to={to} className={cls} {...rest}>
        {content}
      </Link>
    );
  }
  if (href) {
    return (
      <a ref={ref} href={href} className={cls} {...rest}>
        {content}
      </a>
    );
  }
  return (
    <button ref={ref} type={type} className={cls} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {content}
    </button>
  );
});

export default Button;
