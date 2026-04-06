import { useEffect, useLayoutEffect, useRef } from "react";

const ITEM_PX = 44;
const SPACER_PX = (220 - ITEM_PX) / 2;

type Props = {
  options: string[];
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  ariaLabel?: string;
};

export function WheelTimeSelect({ options, value, onChange, disabled, ariaLabel }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const programmatic = useRef(false);
  const scrollEndTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || options.length === 0 || disabled) return;
    const idx = Math.max(0, options.indexOf(value));
    const target = idx * ITEM_PX;
    if (Math.abs(el.scrollTop - target) < 2) return;
    programmatic.current = true;
    el.scrollTo({ top: target, behavior: "auto" });
    window.setTimeout(() => {
      programmatic.current = false;
    }, 100);
  }, [value, options, disabled]);

  useEffect(() => {
    return () => {
      if (scrollEndTimer.current) clearTimeout(scrollEndTimer.current);
    };
  }, []);

  const handleScroll = () => {
    if (disabled || programmatic.current) return;
    if (scrollEndTimer.current) clearTimeout(scrollEndTimer.current);
    scrollEndTimer.current = setTimeout(() => {
      const el = scrollRef.current;
      if (!el || options.length === 0) return;
      const raw = Math.round(el.scrollTop / ITEM_PX);
      const idx = Math.max(0, Math.min(options.length - 1, raw));
      const next = options[idx];
      if (next !== value) onChange(next);
      programmatic.current = true;
      el.scrollTo({ top: idx * ITEM_PX, behavior: "smooth" });
      window.setTimeout(() => {
        programmatic.current = false;
      }, 200);
    }, 100);
  };

  if (options.length === 0) {
    return <div className="wheel-time-empty">無可選時間</div>;
  }

  return (
    <div className="wheel-time" role="region" aria-label={ariaLabel}>
      <div className="wheel-time-viewport">
        <div className="wheel-time-rail" aria-hidden />
        <div
          ref={scrollRef}
          className="wheel-time-scroll"
          onScroll={handleScroll}
          style={{
            opacity: disabled ? 0.45 : 1,
            pointerEvents: disabled ? "none" : "auto",
          }}
        >
          <div className="wheel-time-spacer" style={{ height: SPACER_PX }} aria-hidden />
          {options.map((opt) => (
            <div
              key={opt}
              className={`wheel-time-item ${opt === value ? "active" : ""}`}
              aria-selected={opt === value}
            >
              {opt}
            </div>
          ))}
          <div className="wheel-time-spacer" style={{ height: SPACER_PX }} aria-hidden />
        </div>
      </div>
    </div>
  );
}
