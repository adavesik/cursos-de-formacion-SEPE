import { Analytics } from "@vercel/analytics/react"
import React, { useMemo, useRef, useState, useEffect } from "react";
import readXlsxFile from "read-excel-file";
import Papa from "papaparse";
import ReactECharts from "echarts-for-react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  useReactTable,
  type SortingState,
} from "@tanstack/react-table";
import { debounce } from "lodash";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Download, ExternalLink, Filter as FilterIcon, Loader2, Upload, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import {
  type Course,
  normCode,
  makeUrl,
  toDate,
  fmt,
  loadNivelCache,
  saveNivelCache,
  hydrateNivelFromCache,
  normalizeHeaders,
  categorize,
  toCSV,
  pLimit,
  type NivelCacheEntry,
  NIVEL_CACHE_KEY,
} from "./utils";

function MultiSelect({
  label,
  options,
  values,
  onChange,
  placeholder = "Selecciona…",
  className = "",
}: {
  label?: string;
  options: string[];
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const ref = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const filtered = React.useMemo(() => {
    const qq = q.trim().toLowerCase();
    return qq ? options.filter((o) => o.toLowerCase().includes(qq)) : options;
  }, [options, q]);

  const toggle = (v: string) => {
    if (values.includes(v)) onChange(values.filter((x) => x !== v));
    else onChange([...values, v]);
  };

  const allSelected = values.length && values.length === options.length;

  return (
    <div className={"relative " + className} ref={ref}>
      {label ? <div className="text-sm mb-1">{label}</div> : null}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full border rounded px-3 py-2 text-left flex items-center gap-2 flex-wrap"
      >
        {values.length === 0 ? (
          <span className="text-muted-foreground">{placeholder}</span>
        ) : (
          <div className="flex items-center gap-1 flex-wrap">
            {values.slice(0, 4).map((v) => (
              <span key={v} className="text-xs px-2 py-0.5 rounded bg-muted">
                {v}
              </span>
            ))}
            {values.length > 4 ? (
              <span className="text-xs text-muted-foreground">+{values.length - 4}</span>
            ) : null}
          </div>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {values.length}/{options.length}
        </span>
      </button>

      {open && (
        <div className="absolute z-50 mt-2 w-full rounded border bg-white shadow-sm">
          <div className="p-2 border-b flex items-center gap-2">
            <input
              className="w-full border rounded px-2 py-1 text-sm"
              placeholder="Buscar…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div className="max-h-64 overflow-auto">
            <button
              type="button"
              className="w-full text-left px-3 py-2 text-sm hover:bg-muted/50 flex items-center gap-2"
              onClick={() => onChange(allSelected ? [] : options)}
            >
              <input type="checkbox" checked={!!allSelected} onChange={() => {}} className="h-4 w-4" />
              {allSelected ? "Deseleccionar todo" : "Seleccionar todo"}
            </button>
            <div className="border-t" />
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-sm text-muted-foreground">Sin resultados</div>
            ) : (
              filtered.map((opt) => {
                const checked = values.includes(opt);
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => toggle(opt)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-muted/50 flex items-center gap-2"
                  >
                    <input type="checkbox" checked={checked} onChange={() => toggle(opt)} className="h-4 w-4" />
                    <span className="truncate">{opt}</span>
                  </button>
                );
              })
            )}
          </div>
          <div className="p-2 border-t flex gap-2">
            <button
              type="button"
              className="px-2 py-1 text-sm border rounded"
              onClick={() => onChange([])}
            >
              Limpiar
            </button>
            <button
              type="button"
              className="px-2 py-1 text-sm border rounded ml-auto"
              onClick={() => setOpen(false)}
            >
              Listo
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SortHeader({ column, label }: { column: any; label: string }) {
  const dir = column.getIsSorted() as false | "asc" | "desc";
  return (
    <button
      type="button"
      onClick={column.getToggleSortingHandler()}
      className="inline-flex items-center gap-1"
      title="Ordenar"
    >
      <span>{label}</span>
      {dir === "asc" ? (
        <ArrowUp className="w-3 h-3" />
      ) : dir === "desc" ? (
        <ArrowDown className="w-3 h-3" />
      ) : (
        <ArrowUpDown className="w-3 h-3 opacity-30" />
      )}
    </button>
  );
}

export default function App() {
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [rows, setRows] = useState<Course[]>([]);
  const [apiBase, setApiBase] = useState<string>("");
  const [search, setSearch] = useState("");
  const [municipios, setMunicipios] = useState<string[]>([]);
  const [modalidades, setModalidades] = useState<string[]>([]);
  const [onlyUpcoming, setOnlyUpcoming] = useState(false);
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [selectedRowIds, setSelectedRowIds] = useState<Record<string, boolean>>({});
  const [loadingNivel, setLoadingNivel] = useState(false);
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 50 });
  const [sorting, setSorting] = useState<SortingState>([]);
  const [nivelCache, setNivelCache] = useState<Record<string, NivelCacheEntry>>(() => loadNivelCache());
  const [feedUrl, setFeedUrl] = useState<string>("/madrid_cursos.xlsx");

  const setSearchDebounced = useMemo(() => debounce((value: string) => setSearch(value), 300), []);

  useEffect(() => {
    saveNivelCache(nivelCache);
  }, [nivelCache]);

  async function loadMadridFeed() {
    const url = (feedUrl || "").trim();
    if (!url) return alert("Pon la URL del feed");
    try {
      const res = await fetch(url + `?t=${Date.now()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const lower = url.toLowerCase();

      if (lower.endsWith(".json")) {
        const data: any[] = await res.json();
        const mapped = data.map((r: any, i: number) => ({
          RowId: `feed_${Date.now()}_${i}`,
          Codigo: r.Codigo ?? "",
          Especialidad: r.Eespecialidad ?? r.Especialidad ?? "",
          Denominacion: r.Denominacion ?? "",
          Inicio: r.Inicio ?? null,
          Fin: r.Fin ?? null,
          Modalidad: r.Modalidad ?? "",
          Centro: r.Centro ?? "",
          Municipio: r.Municipio ?? "",
          Nivel: r.Nivel ?? "",
          SEPE_URL: r.SEPE_URL ?? makeUrl(r.Especialidad),
        })) as Course[];
        const hydrated = hydrateNivelFromCache(mapped, nivelCache);
        setRows(hydrated);
      } else if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
        const blob = await res.blob();
        const table = await readXlsxFile(blob, { dateFormat: "yyyy-mm-dd" });
        if (!table.length) throw new Error("Excel vacío.");

        const headers = (table[0] as any[]).map((h) => String(h || ""));
        const body = table.slice(1);

        const mapped = body.map((row, i) => {
          const obj: any = {};
          headers.forEach((h, idx) => (obj[h] = row[idx] ?? null));
          const rr = normalizeHeaders(obj);
          const esp = rr.Especialidad ? String(rr.Especialidad) : "";
          return {
            RowId: `feed_${Date.now()}_${i}`,
            Codigo: rr.Codigo ? String(rr.Codigo) : "",
            Especialidad: esp,
            Denominacion: rr.Denominacion ? String(rr.Denominacion) : "",
            Inicio: rr.Inicio ?? null,
            Fin: rr.Fin ?? null,
            Modalidad: rr.Modalidad ? String(rr.Modalidad) : "",
            Centro: rr.Centro ? String(rr.Centro) : "",
            Municipio: rr.Municipio ? String(rr.Municipio) : "",
            Nivel: "",
            SEPE_URL: makeUrl(esp),
          } as Course;
        });
        const hydrated = hydrateNivelFromCache(mapped, nivelCache);
        setRows(hydrated);
      } else if (lower.endsWith(".csv")) {
        const text = await res.text();
        const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
        const mapped = (parsed.data as Record<string, any>[]).map((r, i) => {
          const rr = normalizeHeaders(r);
          const esp = rr.Especialidad ? String(rr.Especialidad) : "";
          return {
            RowId: `csv_${Date.now()}_${i}`,
            Codigo: rr.Codigo ? String(rr.Codigo) : "",
            Especialidad: esp,
            Denominacion: rr.Denominacion ? String(rr.Denominacion) : "",
            Inicio: rr.Inicio ?? null,
            Fin: rr.Fin ?? null,
            Modalidad: rr.Modalidad ? String(rr.Modalidad) : "",
            Centro: rr.Centro ? String(rr.Centro) : "",
            Municipio: rr.Municipio ? String(rr.Municipio) : "",
            Nivel: "",
            SEPE_URL: makeUrl(esp),
          } as Course;
        });
        const hydrated = hydrateNivelFromCache(mapped, nivelCache);
        setRows(hydrated);
      } else {
        throw new Error("Extensión no soportada. Usa .xlsx, .xls, .csv o .json.");
      }

      setMunicipios([]);
      setModalidades([]);
      setSearch("");
      setOnlyUpcoming(false);
      setDateFrom("");
      setDateTo("");
      setSelectedRowIds({});
    } catch (e) {
      console.error(e);
      alert("No pude cargar el feed. Revisa la URL o si devuelve 404.");
    }
  }

  const options = useMemo(() => {
    const muni = Array.from(new Set(rows.map((r) => r.Municipio).filter(Boolean))).sort() as string[];
    const moda = Array.from(new Set(rows.map((r) => r.Modalidad).filter(Boolean))).sort() as string[];
    return { muni, moda };
  }, [rows]);

  const filtered = useMemo(() => {
    let d = [...rows];

    if (municipios.length) d = d.filter((r) => r.Municipio && municipios.includes(r.Municipio));
    if (modalidades.length) d = d.filter((r) => r.Modalidad && modalidades.includes(r.Modalidad));

    if (dateFrom) {
      const from = new Date(dateFrom);
      from.setHours(0, 0, 0, 0);
      d = d.filter((r) => {
        const di = toDate(r.Inicio);
        return di != null && di >= from;
      });
    }

    if (dateTo) {
      const to = new Date(dateTo);
      to.setHours(23, 59, 59, 999);
      d = d.filter((r) => {
        const di = toDate(r.Inicio);
        return di != null && di <= to;
      });
    }

    if (onlyUpcoming) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      d = d.filter((r) => {
        const di = toDate(r.Inicio);
        return di != null && di >= today;
      });
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      d = d.filter(
        (r) =>
          (r.Denominacion || "").toLowerCase().includes(q) ||
          (r.Centro || "").toLowerCase().includes(q) ||
          (r.Especialidad || "").toLowerCase().includes(q) ||
          (r.Municipio || "").toLowerCase().includes(q)
      );
    }
    return d;
  }, [rows, municipios, modalidades, dateFrom, dateTo, onlyUpcoming, search]);

  const chartData = useMemo(() => {
    const counts = new Map<string, number>();
    filtered.forEach((r) => {
      const cat = categorize(`${r.Denominacion} ${r.Especialidad}`);
      counts.set(cat, (counts.get(cat) || 0) + 1);
    });
    const categories = Array.from(counts.keys());
    const values = categories.map((c) => counts.get(c) || 0);
    return {
      option: {
        tooltip: { trigger: "axis" },
        xAxis: { type: "category", data: categories },
        yAxis: { type: "value" },
        series: [{ type: "bar", data: values }],
        grid: { left: 40, right: 20, bottom: 80, top: 20 },
      },
      total: filtered.length,
    };
  }, [filtered]);

  useEffect(() => {
    setPagination((p) => ({ ...p, pageIndex: 0 }));
  }, [filtered.length]);

  const col = createColumnHelper<Course>();

  const dateSortFn = (rowA: any, rowB: any, columnId: string) => {
    const da = toDate(rowA.getValue(columnId));
    const db = toDate(rowB.getValue(columnId));
    const va = da ? da.getTime() : -Infinity;
    const vb = db ? db.getTime() : -Infinity;
    return va === vb ? 0 : va < vb ? -1 : 1;
  };

  const columns = useMemo(
    () => [
      col.display({
        id: "sel",
        header: () => <span className="text-xs text-muted-foreground">Select</span>,
        cell: ({ row }) => (
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={!!selectedRowIds[row.original.RowId]}
            onChange={(e) => setSelectedRowIds((prev) => ({ ...prev, [row.original.RowId]: e.target.checked }))}
          />
        ),
        size: 40,
        enableSorting: false,
      }),
      col.accessor("Codigo", {
        header: ({ column }) => <SortHeader column={column} label="Código" />,
        cell: (info) => info.getValue() || "",
      }),
      col.accessor("Especialidad", {
        header: ({ column }) => <SortHeader column={column} label="Especialidad (SEPE)" />,
        cell: ({ row, getValue }) => (
          <Input
            defaultValue={getValue() || ""}
            onBlur={(e) =>
              updateRow(row.original.RowId, {
                Especialidad: e.currentTarget.value,
                SEPE_URL: makeUrl(e.currentTarget.value),
              })
            }
            className="h-8"
          />
        ),
      }),
      col.accessor("Nivel", {
        header: ({ column }) => <SortHeader column={column} label="Nivel" />,
        cell: (info) => <span className="px-2 py-0.5 rounded bg-muted text-xs">{info.getValue() || ""}</span>,
      }),
      col.display({
        id: "sepe",
        header: "SEPE",
        enableSorting: false,
        cell: ({ row }) =>
          row.original.SEPE_URL ? (
            <a href={row.original.SEPE_URL} target="_blank" className="inline-flex items-center gap-1 text-primary underline">
              Abrir <ExternalLink className="w-3 h-3" />
            </a>
          ) : (
            <span className="text-muted-foreground text-xs">—</span>
          ),
      }),
      col.accessor("Denominacion", {
        header: ({ column }) => <SortHeader column={column} label="Denominación" />,
      }),
      col.accessor("Inicio", {
        header: ({ column }) => <SortHeader column={column} label="Inicio" />,
        cell: (info) => fmt(toDate(info.getValue())),
        sortingFn: dateSortFn,
      }),
      col.accessor("Fin", {
        header: ({ column }) => <SortHeader column={column} label="Fin" />,
        cell: (info) => fmt(toDate(info.getValue())),
        sortingFn: dateSortFn,
      }),
      col.accessor("Modalidad", { header: ({ column }) => <SortHeader column={column} label="Modalidad" /> }),
      col.accessor("Centro", { header: ({ column }) => <SortHeader column={column} label="Centro" /> }),
      col.accessor("Municipio", { header: ({ column }) => <SortHeader column={column} label="Municipio" /> }),
    ],
    [selectedRowIds]
  );

  const table = useReactTable({
    data: filtered,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    state: { pagination, sorting },
    onPaginationChange: setPagination,
    onSortingChange: setSorting,
  });

  function updateRow(id: string, patch: Partial<Course>) {
    setRows((prev) => prev.map((r) => (r.RowId === id ? { ...r, ...patch } : r)));
  }

  async function handleFile(file: File) {
    const ext = file.name.toLowerCase().split(".").pop() || "";
    if (ext === "csv") {
      const text = await file.text();
      const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
      const next = (parsed.data as Record<string, any>[]).map((r, i) => {
        const rr = normalizeHeaders(r);
        const esp = rr.Especialidad ? String(rr.Especialidad) : "";
        return {
          RowId: `csv_${Date.now()}_${i}`,
          Codigo: rr.Codigo ? String(rr.Codigo) : "",
          Especialidad: esp,
          Denominacion: rr.Denominacion ? String(rr.Denominacion) : "",
          Inicio: rr.Inicio ?? null,
          Fin: rr.Fin ?? null,
          Modalidad: rr.Modalidad ? String(rr.Modalidad) : "",
          Centro: rr.Centro ? String(rr.Centro) : "",
          Municipio: rr.Municipio ? String(rr.Municipio) : "",
          Nivel: "",
          SEPE_URL: makeUrl(esp),
        } as Course;
      });
      const hydrated = hydrateNivelFromCache(next, nivelCache);
      setRows(hydrated);
      setMunicipios([]);
      setModalidades([]);
      setSearch("");
      setOnlyUpcoming(false);
      setDateFrom("");
      setDateTo("");
      setSelectedRowIds({});
      return;
    }

    const arows = await readXlsxFile(file, { dateFormat: "yyyy-mm-dd" });
    if (!arows.length) return;
    const headers = (arows[0] as any[]).map((h) => String(h || ""));
    const body = arows.slice(1);
    const objects = body.map((row, i) => {
      const obj: any = {};
      headers.forEach((h, idx) => (obj[h] = row[idx] ?? null));
      const rr = normalizeHeaders(obj);
      const esp = rr.Especialidad ? String(rr.Especialidad) : "";
      return {
        RowId: `xlsx_${Date.now()}_${i}`,
        Codigo: rr.Codigo ? String(rr.Codigo) : "",
        Especialidad: esp,
        Denominacion: rr.Denominacion ? String(rr.Denominacion) : "",
        Inicio: rr.Inicio ?? null,
        Fin: rr.Fin ?? null,
        Modalidad: rr.Modalidad ? String(rr.Modalidad) : "",
        Centro: rr.Centro ? String(rr.Centro) : "",
        Municipio: rr.Municipio ? String(rr.Municipio) : "",
        Nivel: "",
        SEPE_URL: makeUrl(esp),
      } as Course;
    });
    const hydrated = hydrateNivelFromCache(objects, nivelCache);
    setRows(hydrated);
    setMunicipios([]);
    setModalidades([]);
    setSearch("");
    setOnlyUpcoming(false);
    setDateFrom("");
    setDateTo("");
    setSelectedRowIds({});
  }

async function fetchNivelForSelected() {
  const selected = filtered.filter((r) => selectedRowIds[r.RowId]);
  console.log("Selected rows:", selected.map(r => ({ RowId: r.RowId, Especialidad: r.Especialidad })));
  if (!selected.length) {
    alert("Selecciona una o más filas");
    return;
  }
  if (!apiBase) {
    alert(
      'Configura un endpoint API para fetch de Nivel (por ejemplo: https://nivel-api.yourname.workers.dev). Endpoint esperado: GET /?code=CODE → { "nivel": "1|2|3" }'
    );
    return;
  }
  setLoadingNivel(true);
  try {
    const now = Date.now();
    const toFetch: Course[] = [];
    const cachedRows: Course[] = [];

    // Step 1: Collect rows to fetch and apply cached data
    for (const row of selected) {
      const code = normCode(row.Especialidad);
      console.log(`Checking cache for row ${row.RowId}, code ${code}:`, nivelCache[code]);
      if (!code) {
        console.log(`Skipping row ${row.RowId}: Invalid or empty Especialidad`);
        cachedRows.push({ ...row, Nivel: row.Nivel || "", SEPE_URL: row.SEPE_URL || makeUrl(row.Especialidad) });
        continue;
      }
      const entry = nivelCache[code];
      if (entry?.nivel && entry.nivel.trim()) {
        console.log(`Cache hit for ${code}:`, entry);
        cachedRows.push({ ...row, Nivel: row.Nivel || entry.nivel, SEPE_URL: row.SEPE_URL || entry.sepe_url || makeUrl(row.Especialidad) });
      } else {
        console.log(`No valid cache for ${code}, adding to fetch`);
        toFetch.push(row);
      }
    }

    console.log("Rows to fetch:", toFetch.map(r => ({ RowId: r.RowId, Especialidad: r.Especialidad })));
    console.log("Cached rows:", cachedRows.map(r => ({ RowId: r.RowId, Especialidad: r.Especialidad, Nivel: r.Nivel })));

    // Step 2: Update rows with cached data
    if (cachedRows.length) {
      setRows((prev) =>
        prev.map((r) => {
          const cached = cachedRows.find(c => c.RowId === r.RowId);
          return cached || r;
        })
      );
    }

    // Step 3: Exit if no rows need fetching
    if (!toFetch.length) {
      console.log("All selected rows had valid cached data, no fetch needed");
      setSelectedRowIds((prev) => {
        const next = { ...prev };
        for (const row of cachedRows) {
          if (row.Nivel?.trim()) delete next[row.RowId];
        }
        return next;
      });
      return;
    }

    // Step 4: Fetch data for remaining rows
    const tasks = toFetch.map((row) => async () => {
      const code = normCode(row.Especialidad);
      if (!code) {
        console.log(`Skipping fetch for row ${row.RowId}: Invalid code`);
        return { id: row.RowId, nivel: "", sepe_url: makeUrl(row.Especialidad) };
      }
      const url = `${apiBase.replace(/\/$/, "")}/?code=${encodeURIComponent(code)}`;
      console.log(`Fetching: ${url}`);
      try {
        const res = await fetch(url, {
          cache: "no-store",
          headers: { "Accept": "application/json" },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        const data = await res.json();
        console.log(`Response for ${code}:`, data);
        if (!data || typeof data.nivel !== "string") {
          throw new Error(`Invalid response format for ${code}: Expected { nivel: string }`);
        }
        const nivel = String(data.nivel || "");
        const sepe_url = data.sepe_url || makeUrl(code);
        setNivelCache((prev) => ({ ...prev, [code]: { nivel, sepe_url, ts: now } }));
        return { id: row.RowId, nivel, sepe_url };
      } catch (error) {
        console.error(`Fetch failed for ${code}:`, error);
        return { id: row.RowId, nivel: "", sepe_url: makeUrl(row.Especialidad) };
      }
    });

    const results = await pLimit(4, tasks);
    console.log("Fetch results:", results);
    const map = new Map(results.map((r) => [r.id, r]));

    // Step 5: Update rows with fetched data
    setRows((prev) =>
      prev.map((r) =>
        map.has(r.RowId)
          ? { ...r, Nivel: map.get(r.RowId)!.nivel, SEPE_URL: map.get(r.RowId)!.sepe_url || makeUrl(r.Especialidad) }
          : r
      )
    );

    // Step 6: Uncheck only successfully fetched rows
    setSelectedRowIds((prev) => {
      const next = { ...prev };
      for (const row of toFetch) {
        const result = map.get(row.RowId);
        if (result?.nivel?.trim()) delete next[row.RowId];
      }
      return next;
    });
  } catch (error) {
    console.error("General error in fetchNivelForSelected:", error);
    alert(`Error al obtener niveles: ${error || error}. Revisa el endpoint API o CORS.`);
  } finally {
    setLoadingNivel(false);
  }
}

  function exportCSV() {
    const csv = toCSV(filtered);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "cursos_filtrados.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <h1 className="text-2xl font-bold">Cursos + Nivel (SEPE)</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="API base (p.ej. https://nivel-api.yourname.workers.dev)"
            value={apiBase}
            onChange={(e) => setApiBase(e.target.value)}
            className="w-[360px]"
          />
          <Button variant="outline" onClick={() => fileInput.current?.click()}>
            <Upload className="w-4 h-4 mr-2" />
            Importar Excel/CSV
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.currentTarget.value = "";
            }}
          />
          <Button onClick={exportCSV}>
            <Download className="w-4 h-4 mr-2" />
            Export CSV (filtrado)
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setNivelCache({});
              localStorage.removeItem(NIVEL_CACHE_KEY);
              alert("Cache cleared");
            }}
          >
            Clear Cache
          </Button>
          <Input
            className="border rounded px-2 py-1 w-[360px]"
            placeholder="URL del feed (p. ej. /madrid_cursos.xlsx)"
            value={feedUrl}
            onChange={(e) => setFeedUrl(e.target.value)}
          />
          <Button variant="secondary" onClick={loadMadridFeed}>
            Cargar feed
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className="rounded border p-3">
          <div className="text-sm text-muted-foreground">Cursos cargados</div>
          <div className="text-2xl font-semibold">{rows.length}</div>
        </div>
        <div className="rounded border p-3">
          <div className="text-sm text-muted-foreground">Filtrados</div>
          <div className="text-2xl font-semibold">{filtered.length}</div>
        </div>
        <div className="rounded border p-3">
          <div className="text-sm text-muted-foreground">Con Nivel</div>
          <div className="text-2xl font-semibold">{filtered.filter((r) => r.Nivel).length}</div>
        </div>
        <div className="rounded border p-3">
          <div className="text-sm text-muted-foreground">Sin Nivel</div>
          <div className="text-2xl font-semibold">{filtered.filter((r) => !r.Nivel).length}</div>
        </div>
      </div>

      <div className="rounded border">
        <div className="p-3 border-b flex items-center justify-between">
          <div className="font-medium">Filtros</div>
          <div className="flex items-center gap-2">
            <button
              className="px-2 py-1 text-sm border rounded"
              onClick={() => {
                setMunicipios([]);
                setModalidades([]);
                setDateFrom("");
                setDateTo("");
                setOnlyUpcoming(false);
                setSearch("");
              }}
            >
              Limpiar
            </button>
          </div>
        </div>

        <div className="p-3 grid grid-cols-1 md:grid-cols-6 gap-3">
          <MultiSelect label="Municipio" options={options.muni} values={municipios} onChange={setMunicipios} />
          <MultiSelect label="Modalidad" options={options.moda} values={modalidades} onChange={setModalidades} />
          <div>
            <div className="text-sm mb-1">Inicio desde</div>
            <input
              type="date"
              className="w-full border rounded p-2"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </div>
          <div>
            <div className="text-sm mb-1">Inicio hasta</div>
            <input
              type="date"
              className="w-full border rounded p-2"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              id="upcoming"
              type="checkbox"
              checked={onlyUpcoming}
              onChange={(e) => setOnlyUpcoming(e.target.checked)}
            />
            <label htmlFor="upcoming" className="text-sm">
              Solo próximos
            </label>
          </div>
          <div className="md:col-span-2">
            <div className="text-sm mb-1">Buscar</div>
            <input
              className="w-full border rounded p-2"
              placeholder="denominación, centro, especialidad, municipio..."
              value={search}
              onChange={(e) => setSearchDebounced(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="rounded border">
        <div className="p-3 border-b font-medium">Distribución por categoría (filtrado)</div>
        <div className="p-3">
          <ReactECharts option={chartData.option} style={{ height: 320 }} />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button onClick={fetchNivelForSelected} disabled={loadingNivel}>
          {loadingNivel ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FilterIcon className="w-4 h-4 mr-2" />}
          Fetch Nivel (SEPE) para seleccionados
        </Button>
        <span className="text-sm text-muted-foreground">Selecciona filas con la casilla de la 1ª columna.</span>
      </div>

      <div className="rounded-md border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => (
                  <th
                    key={h.id}
                    className="text-left font-medium p-2"
                    aria-sort={h.column.getIsSorted() === "asc" ? "ascending" : h.column.getIsSorted() === "desc" ? "descending" : "none"}
                  >
                    {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((r) => (
              <tr key={r.id} className="border-t">
                {r.getVisibleCells().map((c) => (
                  <td key={c.id} className="p-2 align-top">
                    {flexRender(c.column.columnDef.cell, c.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex flex-col md:flex-row items-center justify-between gap-3 mt-3 px-2 pb-3">
          <div className="text-sm text-muted-foreground">
            Mostrando{" "}
            <strong>
              {filtered.length === 0 ? 0 : pagination.pageIndex * pagination.pageSize + 1}
              {"–"}
              {Math.min((pagination.pageIndex + 1) * pagination.pageSize, filtered.length)}
            </strong>{" "}
            de <strong>{filtered.length}</strong>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => table.setPageIndex(0)} disabled={!table.getCanPreviousPage()}>
              « Primero
            </Button>
            <Button variant="outline" size="sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
              ‹ Anterior
            </Button>
            <span className="text-sm">
              Página <strong>{table.getState().pagination.pageIndex + 1}</strong> de <strong>{table.getPageCount() || 1}</strong>
            </span>
            <Button variant="outline" size="sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
              Siguiente ›
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.setPageIndex(table.getPageCount() - 1)}
              disabled={!table.getCanNextPage()}
            >
              Último »
            </Button>

            <div className="flex items-center gap-2">
              <span className="text-sm">Filas por página:</span>
              <select
                className="border rounded px-2 py-1 text-sm"
                value={pagination.pageSize}
                onChange={(e) => table.setPageSize(Number(e.target.value))}
              >
                {[20, 50, 100, 200, 500].map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>
      <Analytics />
    </div>
  );
}