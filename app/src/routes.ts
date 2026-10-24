export const repertoirePath = (id: number | string) => `/repertoires/${id}`;

export const buildPath = (id: number | string, path: string[] = []) =>
  `/repertoires/${id}/build${path.length ? `?path=${encodeURIComponent(path.join(","))}` : ""}`;

/** filter: due | daily | recommended | difficult-due | difficult | early | all | line */
export const practicePath = (id: number | string, filter = "due", path: string[] = []) =>
  `/repertoires/${id}/practice?filter=${filter}${path.length ? `&path=${encodeURIComponent(path.join(","))}` : ""}`;

export const learnPath = (id: number | string) => `/repertoires/${id}/learn`;

export function parsePath(value: string | null) {
  return (value || "").split(",").map((s) => s.trim()).filter(Boolean);
}
