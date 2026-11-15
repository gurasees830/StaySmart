import { Star } from "lucide-react";
import { cn } from "../lib/utils";

type Props = {
  rating: number;
  source?: string;
  size?: "sm" | "md";
  showLabel?: boolean;
};

const StarRating = ({ rating, source, size = "sm", showLabel = false }: Props) => {
  const estimated = source === "estimated";
  const label =
    source === "official"
      ? `${rating}-star hotel (official rating)`
      : estimated
        ? `Estimated ${rating}-star category`
        : `${rating}-star hotel`;
  return (
    <span className="inline-flex items-center gap-1" title={label} aria-label={label}>
      <span className="inline-flex">
        {Array.from({ length: 5 }, (_, i) => (
          <Star
            key={i}
            className={cn(
              size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4",
              i < rating ? (estimated ? "fill-amber-300 text-amber-300" : "fill-amber-400 text-amber-400") : "fill-slate-200 text-slate-200"
            )}
          />
        ))}
      </span>
      {showLabel && <span className="text-xs text-slate-500">{estimated ? "est." : source === "official" ? "official" : ""}</span>}
    </span>
  );
};

export default StarRating;
