import { useQuery } from "react-query";
import { fetchGooglePhotoCredits } from "../lib/api";
import { cn } from "../lib/utils";

/**
 * Attribution required by Google for Places photos: the photo's author(s)
 * (linked where Google provides a link) and "Google Maps".
 */
const GoogleAttribution = ({
  hotelId,
  photoIndex,
  variant = "overlay",
  className,
}: {
  hotelId: string;
  photoIndex: number;
  variant?: "overlay" | "line";
  className?: string;
}) => {
  const { data } = useQuery(["gphoto-credits", hotelId], () => fetchGooglePhotoCredits(hotelId), {
    staleTime: 10 * 60 * 1000,
    retry: false,
  });
  const authors = data?.photos.find((p) => p.index === photoIndex)?.authors || [];

  const author = authors.length ? (
    <>
      {authors.map((a, i) => (
        <span key={`${a.name}-${i}`}>
          {i > 0 && ", "}
          {a.uri ? (
            <a href={a.uri} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
              {a.name}
            </a>
          ) : (
            a.name
          )}
        </span>
      ))}
      {" · "}
    </>
  ) : null;

  const mark = data?.mapsUrl ? (
    <a href={data.mapsUrl} target="_blank" rel="noreferrer" className="font-semibold hover:underline">
      Google Maps
    </a>
  ) : (
    <span className="font-semibold">Google Maps</span>
  );

  if (variant === "line") {
    return (
      <p className={cn("truncate text-xs text-slate-500", className)}>
        Photo: {author}
        {mark}
      </p>
    );
  }
  return (
    <span className={cn("max-w-[85%] truncate rounded bg-black/55 px-1.5 py-0.5 text-[10px] text-white backdrop-blur", className)}>
      {author}
      {mark}
    </span>
  );
};

export default GoogleAttribution;
