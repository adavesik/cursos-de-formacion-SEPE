import { format } from "date-fns";

export type Course = {
  RowId: string;
  Codigo?: string;
  Especialidad?: string;
  Denominacion?: string;
  Inicio?: string | Date | null;
  Fin?: string | Date | null;
  Modalidad?: string;
  Centro?: string;
  Municipio?: string;
  Nivel?: string;
  SEPE_URL?: string;
};

export const BASE_SEPE =
  "https://sede.sepe.gob.es/especialidadesformativas/RXBuscadorEFRED/DetalleEspecialidad.do?codEspecialidad=";

export type NivelCacheEntry = { nivel: string; sepe_url?: string; ts: number };
export const NIVEL_CACHE_KEY = "nivelCache:v1";
export const NIVEL_TTL_MS = 180 * 24 * 60 * 60 * 1000; // 180 days

export function normCode(code?: string) {
  return (code || "").trim().toUpperCase();
}

export function makeUrl(code?: string) {
  const normalized = normCode(code);
  return normalized ? `${BASE_SEPE}${encodeURIComponent(normalized)}` : "";
}

export function toDate(v: any): Date | null {
  if (v == null) return null;
  if (v instanceof Date && !isNaN(+v)) return v;
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const d = new Date(v);
    return isNaN(+d) ? null : d;
  }
  return null;
}

export function fmt(d: Date | null | undefined) {
  return d ? format(d, "yyyy-MM-dd") : "";
}

export function loadNivelCache(): Record<string, NivelCacheEntry> {
  try {
    const raw = localStorage.getItem(NIVEL_CACHE_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw) as Record<string, NivelCacheEntry>;
    const now = Date.now();
    let changed = false;
    for (const k of Object.keys(obj)) {
      if (!obj[k]?.ts || now - obj[k].ts > NIVEL_TTL_MS) {
        delete obj[k];
        changed = true;
      }
    }
    if (changed) saveNivelCache(obj);
    return obj;
  } catch {
    return {};
  }
}

export function saveNivelCache(cache: Record<string, NivelCacheEntry>) {
  try {
    const entries = Object.entries(cache);
    if (entries.length > 1000) {
      const sorted = entries.sort((a, b) => b[1].ts - a[1].ts);
      const trimmed = Object.fromEntries(sorted.slice(0, 1000));
      localStorage.setItem(NIVEL_CACHE_KEY, JSON.stringify(trimmed));
    } else {
      localStorage.setItem(NIVEL_CACHE_KEY, JSON.stringify(cache));
    }
  } catch {}
}

export function hydrateNivelFromCache(rows: Course[], cache: Record<string, NivelCacheEntry>): Course[] {
  return rows.map((r) => {
    const entry = cache[normCode(r.Especialidad)];
    return entry?.nivel ? { ...r, Nivel: r.Nivel || entry.nivel, SEPE_URL: r.SEPE_URL || entry.sepe_url || makeUrl(r.Especialidad) } : r;
  });
}

export function normalizeHeaders(obj: any) {
  const out: any = {};
  const norm = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .replace(/\s+/g, "")
      .trim();

  const map: Record<string, string> = {
    codigodelcurso: "Codigo",
    codigo: "Codigo",
    especialidad: "Especialidad",
    denominacion: "Denominacion",
    inicio: "Inicio",
    fin: "Fin",
    modalidad: "Modalidad",
    centro: "Centro",
    municipio: "Municipio",
    localidad: "Municipio",
  };

  for (const k of Object.keys(obj)) {
    const nk = map[norm(k)] || k;
    out[nk] = obj[k];
  }
  return out;
}

export function categorize(text: string): string {
  const t = (text || "").toLowerCase();
  const rules: [RegExp, string][] = [
    [/auxiliar|administrativ|ofim[aá]tica|contabilidad|nomin|gesti[oó]n documental|recepci[oó]n|secretari/, "Administración / Ofimática"],
    [/atenci[oó]n sociosanitaria|geriatr|dependientes|cuidador|enfermer[ií]a|sanidad|primeros auxilios/, "Sanidad / Atención Social"],
    [/educaci[oó]n infantil|monitor|docencia|formaci[oó]n para el empleo/, "Educación / Monitoraje"],
    [/est[eé]tica|peluquer[ií]a|imagen personal|maquillaje|uñas|barber[ií]a|masaje|spa/, "Estética / Imagen Personal"],
    [/hosteler[ií]a|cocina|pasteler[ií]a|reposter[ií]a|restaurante|camarer/, "Hostelería / Cocina"],
    [/comercio|ventas|dependient|atenci[oó]n al cliente|marketing|televenta|escaparatismo/, "Comercio / Ventas / Marketing"],
    [/inform[aá]tica|programaci[oó]n|sistemas|redes|ciberseguridad|tic|desarrollo web|bases de datos/, "Informática / TIC"],
    [/idiomas?|ingl[eé]s|alem[aá]n|franc[eé]s|espa[ñn]ol/, "Idiomas"],
    [/log[ií]stica|almac[eé]n|carretillero|cadena de suministro|transporte/, "Logística / Almacén"],
    [/mec[aá]nica|automoci[oó]n|soldadura|electricidad|mantenimiento|industrial|montaje|instalaciones|climatizaci[oó]n|refrigeraci[oó]n|frigor|fontaner[ií]a|construcci[oó]n|albañiler|carpinter[ií]a/, "Industria / Mantenimiento / Construcción"],
    [/seguridad|vigilante|prevenci[oó]n de riesgos/, "Seguridad / PRL"],
    [/limpieza/, "Limpieza"],
    [/emprendimiento|autoempleo|gesti[oó]n empresarial/, "Emprendimiento / Gestión"],
  ];
  for (const [rx, cat] of rules) if (rx.test(t)) return cat;
  return "Otros";
}

export function toCSV(rows: Course[]): string {
  const headers = ["Codigo", "Especialidad", "Nivel", "SEPE_URL", "Denominacion", "Inicio", "Fin", "Modalidad", "Centro", "Municipio"];
  const esc = (s?: any) => `"${String(s ?? "").replace(/"/g, '""')}"`;
  const body = rows
    .map((r) =>
      [
        r.Codigo,
        r.Especialidad,
        r.Nivel,
        r.SEPE_URL,
        r.Denominacion,
        fmt(toDate(r.Inicio)),
        fmt(toDate(r.Fin)),
        r.Modalidad,
        r.Centro,
        r.Municipio,
      ]
        .map(esc)
        .join(",")
    )
    .join("\n");
  return [headers.join(","), body].join("\n");
}

export async function pLimit<T>(limit: number, tasks: (() => Promise<T>)[]) {
  const results: T[] = [];
  const executing: Promise<any>[] = [];
  for (const task of tasks) {
    const p = (async () => {
      const r = await task();
      results.push(r);
    })();
    executing.push(p);
    if (executing.length >= limit) await Promise.race(executing);
    for (let i = executing.length - 1; i >= 0; i--) {
      if ("status" in (executing[i] as any)) executing.splice(i, 1);
    }
  }
  await Promise.all(executing);
  return results;
}