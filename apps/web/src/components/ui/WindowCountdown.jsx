import { useEffect, useRef, useState } from "react";

// "14:32" / "1:02:05". Display only.
export function formatCountdown(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

function initialSeconds(seconds, deadline) {
  if (typeof seconds === "number") return Math.max(0, seconds);
  if (deadline) {
    const ms = new Date(deadline).getTime() - Date.now();
    return Number.isFinite(ms) ? Math.max(0, Math.round(ms / 1000)) : null;
  }
  return null;
}

// Counts down the edit window. Prefers the server's remaining seconds
// (`seconds`); falls back to the `deadline` timestamp. Ticks once a second
// and stops at zero. Display only: never decides what the user may do.
export function useWindowCountdown(seconds, deadline) {
  const [left, setLeft] = useState(() => initialSeconds(seconds, deadline));
  const onExpireRef = useRef(null);

  // Re-sync whenever the server sends a fresh value.
  useEffect(() => {
    setLeft(initialSeconds(seconds, deadline));
  }, [seconds, deadline]);

  const running = left !== null && left > 0;
  useEffect(() => {
    if (!running) return undefined;
    const id = setInterval(() => setLeft((s) => (s === null ? s : Math.max(s - 1, 0))), 1000);
    return () => clearInterval(id);
  }, [running]);

  useEffect(() => {
    if (left === 0 && onExpireRef.current) onExpireRef.current();
  }, [left]);

  return [left, onExpireRef];
}

export default function WindowCountdown({ seconds, deadline, suffix = "left to edit", className = "", onExpire }) {
  const [left, onExpireRef] = useWindowCountdown(seconds, deadline);
  onExpireRef.current = onExpire;
  if (left === null) return null;
  return (
    <span className={`tabular-nums ${className}`}>
      {formatCountdown(left)} {suffix}
    </span>
  );
}
