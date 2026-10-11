import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export function CandidatePhoto({ id, hasPhoto, version, name, size = "h-16 w-16" }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    setUrl(null);
    if (!hasPhoto) return undefined;
    let obj = null;
    let alive = true;
    api.get(`/candidates/${id}/photo`, { responseType: "blob" })
      .then((r) => { if (alive) { obj = URL.createObjectURL(r.data); setUrl(obj); } })
      .catch(() => {});
    return () => { alive = false; if (obj) URL.revokeObjectURL(obj); };
  }, [id, hasPhoto, version]);
  const initials = name.split(" ").map((s) => s[0]).slice(0, 2).join("").toUpperCase();
  if (url) return <img src={url} alt={`Photo of ${name}`} className={`${size} shrink-0 rounded-full object-cover shadow-sm ring-2 ring-white`} data-testid={`candidate-photo-${id}`} />;
  return <span className={`${size} grid shrink-0 place-items-center rounded-full bg-sky-50 text-sm font-semibold text-sky-700`} aria-hidden data-testid={`candidate-initials-${id}`}>{initials}</span>;
}
