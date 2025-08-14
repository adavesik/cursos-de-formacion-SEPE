# scraper/scrape_madrid.py
import re
from pathlib import Path
import pandas as pd
from playwright.sync_api import sync_playwright, TimeoutError as PWTimeoutError

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
PUBLIC.mkdir(parents=True, exist_ok=True)
EXCEL_PATH = PUBLIC / "madrid_cursos.xlsx"
JSON_PATH  = PUBLIC / "madrid_cursos.json"
URL = "https://oficinaempleo.comunidad.madrid/BuscadorCursosPublico/"

def normalize_cols(df: pd.DataFrame) -> pd.DataFrame:
    ren = {}
    for c in df.columns:
        k = c.strip()
        if re.search(r"c[oó]digo.*curso", k, re.I): ren[c] = "Codigo"
        elif re.search(r"especialidad", k, re.I):   ren[c] = "Especialidad"
        elif re.search(r"denominaci[oó]n", k, re.I):ren[c] = "Denominacion"
        elif re.search(r"inicio", k, re.I):         ren[c] = "Inicio"
        elif re.search(r"fin", k, re.I):            ren[c] = "Fin"
        elif re.search(r"modalidad", k, re.I):      ren[c] = "Modalidad"
        elif re.search(r"centro", k, re.I):         ren[c] = "Centro"
        elif re.search(r"municipio|localidad", k, re.I): ren[c] = "Municipio"
    if ren: df = df.rename(columns=ren)
    for col in ["Codigo","Especialidad","Denominacion","Modalidad","Centro","Municipio"]:
        if col in df.columns: df[col] = df[col].astype(str).str.strip()
    for col in ["Inicio","Fin"]:
        if col in df.columns:
            df[col] = pd.to_datetime(df[col], errors="coerce").dt.strftime("%Y-%m-%d")
    base_sepe = "https://sede.sepe.gob.es/especialidadesformativas/RXBuscadorEFRED/DetalleEspecialidad.do?codEspecialidad="
    if "Nivel" not in df.columns: df["Nivel"] = ""
    if "SEPE_URL" not in df.columns:
        df["SEPE_URL"] = df.get("Especialidad","").apply(lambda x: base_sepe + x if isinstance(x, str) and x.strip() else "")
    df["RowId"] = [f"madrid_{i}" for i in range(len(df))]
    return df

def run():
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        ctx = browser.new_context(accept_downloads=True)
        page = ctx.new_page()
        page.goto(URL, wait_until="domcontentloaded")

        # Select “Sí”
        try:
            page.get_by_label(re.compile(r"Especialidad.*certificado", re.I)).select_option(label=re.compile(r"^s[ií]$", re.I))
        except Exception:
            # fallback: try the first select with 'Sí'
            found = False
            for i in range(page.locator("select").count()):
                try:
                    page.locator("select").nth(i).select_option(label=re.compile(r"^s[ií]$", re.I))
                    found = True
                    break
                except Exception:
                    pass
            if not found:
                raise RuntimeError("No pude seleccionar 'Sí' en 'Especialidad de certificado'.")

        # Buscar
        try:
            page.get_by_role("button", name=re.compile(r"^buscar$", re.I)).click()
        except PWTimeoutError:
            pass
        page.wait_for_timeout(2000)

        # Exportar a Excel
        with page.expect_download(timeout=30000) as dl:
            try:
                page.get_by_role("button", name=re.compile(r"exportar.*excel", re.I)).click()
            except Exception:
                page.locator("text=/Exportar\\s+resultados\\s+a\\s+Excel/i").click()
        download = dl.value
        download.save_as(EXCEL_PATH)

        if not EXCEL_PATH.exists() or EXCEL_PATH.stat().st_size < 1000:
            raise RuntimeError("Excel no descargado o vacío.")

        df = pd.read_excel(EXCEL_PATH)
        if df.empty:
            raise RuntimeError("Excel descargado pero sin filas.")
        df = normalize_cols(df)
        df.to_json(JSON_PATH, orient="records", force_ascii=False)

        print(f"OK → {EXCEL_PATH} ({EXCEL_PATH.stat().st_size} bytes)")
        print(f"OK → {JSON_PATH} ({JSON_PATH.stat().st_size} bytes)")

        ctx.close(); browser.close()

if __name__ == "__main__":
    run()
