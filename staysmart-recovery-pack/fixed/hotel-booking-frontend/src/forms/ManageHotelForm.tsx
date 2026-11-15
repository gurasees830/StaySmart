import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { ImagePlus, Loader2, Star, Trash2 } from "lucide-react";
import { FACILITIES, HOTEL_TYPES } from "../lib/constants";
import { cn, thumbUrl } from "../lib/utils";
import type { Hotel } from "../types";

export type HotelFormValues = {
  name: string;
  city: string;
  state: string;
  street: string;
  locality: string;
  zipCode: string;
  latitude: string;
  longitude: string;
  description: string;
  type: string[];
  pricePerNight: number;
  starRating: number;
  adultCount: number;
  childCount: number;
  facilities: string[];
  phone: string;
  email: string;
  website: string;
  checkInTime: string;
  checkOutTime: string;
  cancellationPolicy: string;
  petPolicy: string;
  smokingPolicy: string;
};

const STATES = [
  "Andaman and Nicobar Islands", "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chandigarh", "Chhattisgarh",
  "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jammu and Kashmir",
  "Jharkhand", "Karnataka", "Kerala", "Ladakh", "Lakshadweep", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya",
  "Mizoram", "Nagaland", "Odisha", "Puducherry", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura",
  "Uttar Pradesh", "Uttarakhand", "West Bengal",
];

const MAX_IMAGES = 6;
const MAX_MB = 5;

type Props = {
  hotel?: Hotel;
  submitLabel: string;
  isSaving: boolean;
  onSave: (form: FormData) => void;
};

const Section = ({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) => (
  <section className="card p-6">
    <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
    {description && <p className="mt-0.5 text-sm text-slate-600">{description}</p>}
    <div className="mt-5">{children}</div>
  </section>
);

const ManageHotelForm = ({ hotel, submitLabel, isSaving, onSave }: Props) => {
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm<HotelFormValues>({
    defaultValues: { type: [], facilities: [], starRating: 3, adultCount: 2, childCount: 1, checkInTime: "12:00", checkOutTime: "11:00" },
  });
  const [keptImages, setKeptImages] = useState<string[]>([]);
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [imageError, setImageError] = useState("");

  // "type" is an array managed with setValue, so it is registered without a DOM input.
  useEffect(() => {
    register("type", { validate: (v) => (Array.isArray(v) && v.length > 0) || "Select at least one type" });
  }, [register]);

  useEffect(() => {
    if (!hotel) return;
    const a = hotel.location?.address || {};
    reset({
      name: hotel.name,
      city: hotel.city,
      state: a.state || "",
      street: a.street || "",
      locality: a.locality || "",
      zipCode: a.zipCode || "",
      latitude: hotel.location?.latitude ? String(hotel.location.latitude) : "",
      longitude: hotel.location?.longitude ? String(hotel.location.longitude) : "",
      description: hotel.description,
      type: hotel.type,
      pricePerNight: hotel.pricePerNight,
      starRating: hotel.starRating,
      adultCount: hotel.adultCount,
      childCount: hotel.childCount,
      facilities: hotel.facilities,
      phone: hotel.contact?.phone || "",
      email: hotel.contact?.email || "",
      website: hotel.contact?.website || "",
      checkInTime: hotel.policies?.checkInTime || "",
      checkOutTime: hotel.policies?.checkOutTime || "",
      cancellationPolicy: hotel.policies?.cancellationPolicy || "",
      petPolicy: hotel.policies?.petPolicy || "",
      smokingPolicy: hotel.policies?.smokingPolicy || "",
    });
    setKeptImages(hotel.imageUrls || []);
  }, [hotel, reset]);

  const previews = useMemo(() => newFiles.map((f) => URL.createObjectURL(f)), [newFiles]);
  useEffect(() => () => previews.forEach((p) => URL.revokeObjectURL(p)), [previews]);

  const types = watch("type") || [];
  const facilities = watch("facilities") || [];
  const starRating = Number(watch("starRating"));

  const toggleList = (field: "type" | "facilities", value: string) => {
    const current = field === "type" ? types : facilities;
    setValue(field, current.includes(value) ? current.filter((v) => v !== value) : [...current, value], { shouldValidate: true });
  };

  const onFiles = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    const tooBig = files.find((f) => f.size > MAX_MB * 1024 * 1024);
    const wrongType = files.find((f) => !/^image\/(jpeg|png|webp)$/.test(f.type));
    if (tooBig) return setImageError(`${tooBig.name} is larger than ${MAX_MB} MB`);
    if (wrongType) return setImageError(`${wrongType.name} is not a JPG, PNG or WebP image`);
    if (keptImages.length + newFiles.length + files.length > MAX_IMAGES) return setImageError(`You can have up to ${MAX_IMAGES} photos`);
    setImageError("");
    setNewFiles((list) => [...list, ...files]);
  };

  const onSubmit = (values: HotelFormValues) => {
    if (keptImages.length + newFiles.length === 0) {
      setImageError("Add at least one photo of the property");
      return;
    }
    const form = new FormData();
    const simple: (keyof HotelFormValues)[] = ["name", "city", "state", "street", "locality", "zipCode", "latitude", "longitude", "description", "pricePerNight", "starRating", "adultCount", "childCount"];
    simple.forEach((key) => form.append(key, String(values[key] ?? "")));
    values.type.forEach((t) => form.append("type", t));
    values.facilities.forEach((f) => form.append("facilities", f));
    form.append("contact.phone", values.phone || "");
    form.append("contact.email", values.email || "");
    form.append("contact.website", values.website || "");
    form.append("policies.checkInTime", values.checkInTime || "");
    form.append("policies.checkOutTime", values.checkOutTime || "");
    form.append("policies.cancellationPolicy", values.cancellationPolicy || "");
    form.append("policies.petPolicy", values.petPolicy || "");
    form.append("policies.smokingPolicy", values.smokingPolicy || "");
    keptImages.forEach((url) => form.append("imageUrls", url));
    newFiles.forEach((file) => form.append("imageFiles", file));
    onSave(form);
  };

  const err = (key: keyof HotelFormValues) => errors[key] && <p className="field-error">{String(errors[key]?.message || "Required")}</p>;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6" noValidate>
      <Section title="Property details">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label" htmlFor="name">Property name</label>
            <input id="name" className="input" placeholder="e.g. Hotel Sunrise Residency" {...register("name", { required: "Property name is required", minLength: { value: 2, message: "Name is too short" } })} />
            {err("name")}
          </div>
          <div>
            <label className="label" htmlFor="city">City / town</label>
            <input id="city" className="input" placeholder="e.g. Jaipur" {...register("city", { required: "City is required" })} />
            {err("city")}
          </div>
          <div>
            <label className="label" htmlFor="state">State / UT</label>
            <select id="state" className="input" {...register("state", { required: "State is required" })}>
              <option value="">Select state</option>
              {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            {err("state")}
          </div>
          <div>
            <label className="label" htmlFor="street">Street address</label>
            <input id="street" className="input" placeholder="Building, street" {...register("street")} />
          </div>
          <div>
            <label className="label" htmlFor="locality">Area / locality</label>
            <input id="locality" className="input" placeholder="e.g. C-Scheme" {...register("locality")} />
          </div>
          <div>
            <label className="label" htmlFor="zipCode">PIN code</label>
            <input id="zipCode" className="input" inputMode="numeric" {...register("zipCode", { pattern: { value: /^\d{6}$/, message: "PIN code must be 6 digits" } })} />
            {err("zipCode")}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label" htmlFor="latitude">Latitude <span className="font-normal text-slate-400">(optional)</span></label>
              <input id="latitude" className="input" inputMode="decimal" placeholder="26.9124" {...register("latitude", { validate: (v) => !v || (Math.abs(Number(v)) <= 90 && !Number.isNaN(Number(v))) || "Invalid latitude" })} />
              {err("latitude")}
            </div>
            <div>
              <label className="label" htmlFor="longitude">Longitude</label>
              <input id="longitude" className="input" inputMode="decimal" placeholder="75.7873" {...register("longitude", { validate: (v) => !v || (Math.abs(Number(v)) <= 180 && !Number.isNaN(Number(v))) || "Invalid longitude" })} />
              {err("longitude")}
            </div>
          </div>
          <p className="text-xs text-slate-500 sm:col-span-2">Without coordinates the property is placed at the centre of its city on maps.</p>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="description">Description</label>
            <textarea id="description" rows={5} className="input" placeholder="Describe the rooms, location, food and what makes your property special..." {...register("description", { required: "Description is required", minLength: { value: 20, message: "Write at least 20 characters" } })} />
            {err("description")}
          </div>
        </div>
      </Section>

      <Section title="Category & pricing">
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="pricePerNight">Price per night (₹)</label>
            <input id="pricePerNight" type="number" min={100} className="input" {...register("pricePerNight", { required: "Price is required", valueAsNumber: true, min: { value: 100, message: "Minimum ₹100" }, max: { value: 500000, message: "Maximum ₹5,00,000" } })} />
            {err("pricePerNight")}
          </div>
          <div>
            <span className="label">Star rating</span>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" onClick={() => setValue("starRating", n)} className="rounded p-1" aria-label={`${n} stars`}>
                  <Star className={cn("h-7 w-7", n <= starRating ? "fill-amber-400 text-amber-400" : "text-slate-300")} />
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label" htmlFor="adultCount">Adults/room</label>
              <input id="adultCount" type="number" min={1} max={20} className="input" {...register("adultCount", { valueAsNumber: true, required: true, min: { value: 1, message: "At least 1" }, max: 20 })} />
              {err("adultCount")}
            </div>
            <div>
              <label className="label" htmlFor="childCount">Children</label>
              <input id="childCount" type="number" min={0} max={20} className="input" {...register("childCount", { valueAsNumber: true, min: 0, max: 20 })} />
            </div>
          </div>
        </div>
        <div className="mt-5">
          <span className="label">Property type</span>
          <div className="flex flex-wrap gap-2">
            {HOTEL_TYPES.map((t) => (
              <button key={t} type="button" onClick={() => toggleList("type", t)} className={cn("rounded-full border px-3 py-1.5 text-sm font-medium transition", types.includes(t) ? "border-primary-600 bg-primary-600 text-white" : "border-slate-300 text-slate-700 hover:bg-slate-50")}>
                {t}
              </button>
            ))}
          </div>
          {errors.type && <p className="field-error">{String(errors.type.message)}</p>}
        </div>
      </Section>

      <Section title="Facilities">
        <div className="grid gap-2 sm:grid-cols-3">
          {FACILITIES.map((f) => (
            <label key={f} className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50">
              <input type="checkbox" checked={facilities.includes(f)} onChange={() => toggleList("facilities", f)} />
              {f}
            </label>
          ))}
        </div>
      </Section>

      <Section title="Photos" description={`Up to ${MAX_IMAGES} photos, JPG/PNG/WebP, max ${MAX_MB} MB each. The first photo is the cover.`}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {keptImages.map((url) => (
            <div key={url} className="group relative aspect-[4/3] overflow-hidden rounded-xl bg-slate-100">
              <img src={thumbUrl(url)} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
              <button type="button" onClick={() => setKeptImages((list) => list.filter((u) => u !== url))} className="absolute right-2 top-2 rounded-full bg-white/90 p-1.5 text-red-600 shadow" aria-label="Remove photo">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          {previews.map((src, i) => (
            <div key={src} className="group relative aspect-[4/3] overflow-hidden rounded-xl bg-slate-100">
              <img src={src} alt="" className="h-full w-full object-cover" />
              <span className="absolute left-2 top-2 rounded bg-primary-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">NEW</span>
              <button type="button" onClick={() => setNewFiles((list) => list.filter((_, idx) => idx !== i))} className="absolute right-2 top-2 rounded-full bg-white/90 p-1.5 text-red-600 shadow" aria-label="Remove photo">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          {keptImages.length + newFiles.length < MAX_IMAGES && (
            <label className="flex aspect-[4/3] cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 text-slate-500 transition hover:border-primary-400 hover:text-primary-600">
              <ImagePlus className="h-8 w-8" />
              <span className="text-sm font-medium">Add photos</span>
              <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" onChange={onFiles} />
            </label>
          )}
        </div>
        {imageError && <p className="field-error">{imageError}</p>}
      </Section>

      <Section title="Contact & policies">
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="phone">Phone</label>
            <input id="phone" className="input" placeholder="+91 98765 43210" {...register("phone", { pattern: { value: /^[+\d][\d\s-]{6,19}$/, message: "Enter a valid phone number" } })} />
            {err("phone")}
          </div>
          <div>
            <label className="label" htmlFor="email">Email</label>
            <input id="email" type="email" className="input" {...register("email", { pattern: { value: /^\S+@\S+\.\S+$/, message: "Enter a valid email" } })} />
            {err("email")}
          </div>
          <div>
            <label className="label" htmlFor="website">Website</label>
            <input id="website" className="input" placeholder="https://" {...register("website", { pattern: { value: /^(https?:\/\/)?[\w.-]+\.[a-z]{2,}(\/\S*)?$/i, message: "Enter a valid URL" } })} />
            {err("website")}
          </div>
          <div>
            <label className="label" htmlFor="checkInTime">Check-in time</label>
            <input id="checkInTime" type="time" className="input" {...register("checkInTime")} />
          </div>
          <div>
            <label className="label" htmlFor="checkOutTime">Check-out time</label>
            <input id="checkOutTime" type="time" className="input" {...register("checkOutTime")} />
          </div>
          <div />
          <div className="sm:col-span-3">
            <label className="label" htmlFor="cancellationPolicy">Cancellation policy</label>
            <textarea id="cancellationPolicy" rows={2} className="input" placeholder="e.g. Free cancellation up to 24 hours before check-in" {...register("cancellationPolicy")} />
          </div>
          <div className="sm:col-span-3 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="petPolicy">Pet policy</label>
              <input id="petPolicy" className="input" {...register("petPolicy")} />
            </div>
            <div>
              <label className="label" htmlFor="smokingPolicy">Smoking policy</label>
              <input id="smokingPolicy" className="input" {...register("smokingPolicy")} />
            </div>
          </div>
        </div>
      </Section>

      <div className="flex justify-end">
        <button type="submit" className="btn-primary px-8 py-3 text-base" disabled={isSaving}>
          {isSaving && <Loader2 className="h-5 w-5 animate-spin" />} {isSaving ? "Saving..." : submitLabel}
        </button>
      </div>
    </form>
  );
};

export default ManageHotelForm;
