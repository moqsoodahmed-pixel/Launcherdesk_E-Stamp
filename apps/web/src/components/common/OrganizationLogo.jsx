import { useState } from "react";

// Shared avatar for an organization: its uploaded logo image, or a plain
// initials badge when none has been uploaded yet (Organization.logoUrl is
// null) or the image fails to load. Used in the dashboard header
// (OrganizationBadge), the Master Admin organizations list, the
// organization detail page, and Company Profile's own upload preview - one
// visual so every surface renders a missing logo identically.
function initialsOf(name) {
  const source = (name || "").trim();
  if (!source) return "O";
  const parts = source.split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase() || source[0].toUpperCase();
}

export default function OrganizationLogo({ logoUrl, name, size = 32, className = "" }) {
  const [broken, setBroken] = useState(false);
  const dimension = `${size}px`;

  if (logoUrl && !broken) {
    return (
      <img
        src={logoUrl}
        alt={`${name || "Organization"} logo`}
        className={`rounded-full object-cover border border-slate-200 bg-white shrink-0 ${className}`}
        style={{ width: dimension, height: dimension }}
        onError={() => setBroken(true)}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={`inline-flex items-center justify-center rounded-full bg-slate-100 text-slate-500 font-semibold border border-slate-200 shrink-0 ${className}`}
      style={{ width: dimension, height: dimension, fontSize: size * 0.4 }}
    >
      {initialsOf(name)}
    </span>
  );
}
