import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

/**
 * Text that truncates with an ellipsis, and slides right-to-left to reveal the rest while the enclosing
 * `.row-hover` row is hovered (only when it actually overflows). Measures itself on mount and resize.
 */
export function Marquee({ children, className = "", style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  const outer = useRef<HTMLSpanElement>(null);
  const inner = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(0);
  useLayoutEffect(() => {
    const o = outer.current, i = inner.current;
    if (!o || !i) return;
    const measure = () => setOverflow(Math.max(0, i.scrollWidth - o.clientWidth));
    measure();
    const ro = new ResizeObserver(measure); ro.observe(o);
    return () => ro.disconnect();
  }, [children]);
  return (
    <span ref={outer} className={"marquee min-w-0 overflow-hidden text-ellipsis " + className} style={{ ...style, ["--marquee" as string]: `${overflow}px` }}>
      <span ref={inner} className="inline-block whitespace-nowrap">{children}</span>
    </span>
  );
}
