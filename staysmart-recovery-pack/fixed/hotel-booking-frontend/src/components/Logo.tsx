import { Link } from "react-router-dom";
import { cn } from "../lib/utils";

/** StaySmart mark: a map pin whose head is a little house with a lit window. */
export const LogoMark = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 48 48" className={cn("h-9 w-9", className)} aria-hidden>
    <defs>
      <linearGradient id="ss-grad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#2563eb" />
        <stop offset="1" stopColor="#4f46e5" />
      </linearGradient>
    </defs>
    <rect width="48" height="48" rx="13" fill="url(#ss-grad)" />
    <path
      d="M24 9.5c-6.9 0-12.5 5.4-12.5 12.2 0 8.6 10.3 16.1 11.6 17a1.6 1.6 0 0 0 1.8 0c1.3-.9 11.6-8.4 11.6-17C36.5 14.9 30.9 9.5 24 9.5Z"
      fill="#fff"
    />
    <path d="M17.6 22.3 24 17l6.4 5.3v6.4a1 1 0 0 1-1 1H18.6a1 1 0 0 1-1-1Z" fill="#2563eb" />
    <rect x="22.2" y="23.6" width="3.6" height="6.1" rx=".6" fill="#fbbf24" />
  </svg>
);

const Logo = ({ light = false, className }: { light?: boolean; className?: string }) => (
  <Link to="/" className={cn("group flex items-center gap-2.5", className)} aria-label="StaySmart home">
    <LogoMark className="transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-105" />
    <span className="flex flex-col leading-none">
      <span className={cn("text-xl font-extrabold tracking-tight", light ? "text-white" : "text-slate-900")}>
        Stay<span className={light ? "text-primary-300" : "text-primary-600"}>Smart</span>
      </span>
      <span className={cn("mt-0.5 text-[10px] font-semibold uppercase tracking-[0.18em]", light ? "text-slate-400" : "text-slate-400")}>
        Hotel dhundo
      </span>
    </span>
  </Link>
);

export default Logo;
