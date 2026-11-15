import { Star } from "lucide-react";
import { FACILITIES, HOTEL_TYPES, PRICE_RANGES } from "../lib/constants";
import { cn } from "../lib/utils";

export type Filters = {
  stars: string[];
  types: string[];
  facilities: string[];
  minPrice: string;
  maxPrice: string;
  photos: string;
};

type Props = {
  filters: Filters;
  onChange: (filters: Filters) => void;
  onReset: () => void;
};

const toggle = (list: string[], value: string) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <fieldset className="border-b border-slate-200 py-4 last:border-none">
    <legend className="mb-3 text-sm font-semibold text-slate-900">{title}</legend>
    {children}
  </fieldset>
);

const Check = ({ checked, onChange, children }: { checked: boolean; onChange: () => void; children: React.ReactNode }) => (
  <label className="flex cursor-pointer items-center gap-2.5 py-1 text-sm text-slate-700 hover:text-slate-900">
    <input type="checkbox" checked={checked} onChange={onChange} className="h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500" />
    {children}
  </label>
);

const FiltersPanel = ({ filters, onChange, onReset }: Props) => {
  const activeCount =
    filters.stars.length + filters.types.length + filters.facilities.length + (filters.minPrice || filters.maxPrice ? 1 : 0) + (filters.photos ? 1 : 0);

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between border-b border-slate-200 pb-3">
        <h2 className="font-semibold text-slate-900">Filter results</h2>
        {activeCount > 0 && (
          <button onClick={onReset} className="text-sm font-medium text-primary-600 hover:text-primary-700">
            Clear all ({activeCount})
          </button>
        )}
      </div>

      <Section title="Photos">
        <Check checked={filters.photos === "property"} onChange={() => onChange({ ...filters, photos: filters.photos ? "" : "property" })}>
          Only hotels with real property photos
        </Check>
      </Section>

      <Section title="Star rating">
        <div className="flex flex-wrap gap-2">
          {["5", "4", "3", "2", "1"].map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onChange({ ...filters, stars: toggle(filters.stars, s) })}
              className={cn(
                "inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-sm font-medium transition",
                filters.stars.includes(s) ? "border-primary-600 bg-primary-50 text-primary-700" : "border-slate-300 text-slate-700 hover:bg-slate-50"
              )}
              aria-pressed={filters.stars.includes(s)}
            >
              {s} <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
            </button>
          ))}
        </div>
      </Section>

      <Section title="Price per night">
        <div className="space-y-1">
          {PRICE_RANGES.map((r) => {
            const active = filters.minPrice === r.min && filters.maxPrice === r.max;
            return (
              <label key={r.label} className="flex cursor-pointer items-center gap-2.5 py-1 text-sm text-slate-700">
                <input
                  type="radio"
                  name="price"
                  checked={active}
                  onChange={() => onChange({ ...filters, minPrice: r.min, maxPrice: r.max })}
                  className="h-4 w-4 border-slate-300 text-primary-600 focus:ring-primary-500"
                />
                {r.label}
              </label>
            );
          })}
          {(filters.minPrice || filters.maxPrice) && (
            <button className="mt-1 text-xs font-medium text-primary-600" onClick={() => onChange({ ...filters, minPrice: "", maxPrice: "" })}>
              Any price
            </button>
          )}
        </div>
      </Section>

      <Section title="Property type">
        <div className="grid grid-cols-1 gap-x-3">
          {HOTEL_TYPES.map((t) => (
            <Check key={t} checked={filters.types.includes(t)} onChange={() => onChange({ ...filters, types: toggle(filters.types, t) })}>
              {t}
            </Check>
          ))}
        </div>
      </Section>

      <Section title="Facilities">
        <p className="-mt-1 mb-2 text-xs text-slate-500">Based on what each property has published.</p>
        {FACILITIES.map((f) => (
          <Check key={f} checked={filters.facilities.includes(f)} onChange={() => onChange({ ...filters, facilities: toggle(filters.facilities, f) })}>
            {f}
          </Check>
        ))}
      </Section>
    </div>
  );
};

export default FiltersPanel;
