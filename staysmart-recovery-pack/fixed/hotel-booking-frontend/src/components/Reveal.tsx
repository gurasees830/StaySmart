import { ReactNode, useEffect, useRef, useState } from "react";
import { cn } from "../lib/utils";

/** Fades + slides children in when they scroll into view (respects reduced motion). */
const Reveal = ({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "0px 0px -60px 0px", threshold: 0.05 }
    );
    observer.observe(node);
    // Safety net: never leave content hidden (print, background tabs, odd browsers).
    const fallback = window.setTimeout(() => setVisible(true), 4000);
    return () => {
      observer.disconnect();
      window.clearTimeout(fallback);
    };
  }, []);

  return (
    <div
      ref={ref}
      style={{ transitionDelay: `${delay}ms` }}
      className={cn("transition-all duration-700 ease-out", visible ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0", className)}
    >
      {children}
    </div>
  );
};

export default Reveal;
