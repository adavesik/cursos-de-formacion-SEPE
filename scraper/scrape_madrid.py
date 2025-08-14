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
        browser = pw.chromium.launch(headless=True, args=["--no-sandbox"])
        ctx = browser.new_context(accept_downloads=True)
        page = ctx.new_page()
        page.goto(URL, wait_until="domcontentloaded")

        # --- Select “Sí” for “Especialidad de certificado” (value="0") ---
        # If you know the select has an ID, use it directly:
        # page.wait_for_selector('#especialidadCertificado')
        # page.select_option('#especialidadCertificado', '0')

        # General approach (no hard-coded id):
        selected = False

        # 1) Try via accessible label (if the page uses a proper <label for>…)
        try:
            sel = page.get_by_label(re.compile(r"Especialidad.*certificado", re.I))
            # ensure the option exists before selecting
            page.wait_for_selector(sel.selector + ' >> option[value="0"]', timeout=10000)
            sel.select_option("0")
            selected = True
        except Exception:
            pass

        # 2) Try the select that follows a label containing that text
        if not selected:
            try:
                xpath = 'xpath=//label[contains(normalize-space(.),"Especialidad") and contains(.,"certificado")]/following::select[1]'
                page.wait_for_selector(xpath, timeout=10000)
                page.select_option(xpath, "0")
                selected = True
            except Exception:
                pass

        # 3) Brute: find any <select> that has an option value="0"
        if not selected:
            try:
                sel_count = page.locator("select").count()
                for i in range(min(sel_count, 15)):
                    sel_loc = page.locator("select").nth(i)
                    if sel_loc.locator('option[value="0"]').count() > 0:
                        page.select_option(sel_loc, "0")
                        selected = True
                        break
            except Exception:
                pass

        if not selected:
            raise RuntimeError("No pude seleccionar 'Sí' (value='0') en 'Especialidad de certificado'.")

        # --- Click “Buscar” ---
        buscar_clicked = False
        for sel in [
            'role=button[name=/^buscar$/i]',
            'button:has-text("Buscar")',
            'input[type="submit"][value*="Buscar"]',
            'text=/^Buscar$/',
        ]:
            try:
                page.locator(sel).first.click(timeout=5000)
                buscar_clicked = True
                break
            except Exception:
                pass

        if not buscar_clicked:
            raise RuntimeError("No pude pulsar el botón Buscar.")

        # Wait for results to show (table or some result container)
        try:
            page.wait_for_selector("table, .tabla, .grid, .resultados", timeout=15000)
        except PWTimeoutError:
            # give an extra small grace period
            page.wait_for_timeout(2000)

        # --- Exportar a Excel ---
        with page.expect_download(timeout=30000) as dl:
            try:
                page.get_by_role("button", name=re.compile(r"exportar.*excel", re.I)).click()
            except Exception:
                # common fallbacks (anchor link or text)
                for s in [
                    'a:has-text("Exportar resultados a Excel")',
                    'a:has-text("Exportar a Excel")',
                    'text=/Exportar\\s+resultados\\s+a\\s+Excel/i',
                ]:
                    try:
                        page.locator(s).first.click(timeout=4000)
                        break
                    except Exception:
                        pass
        download = dl.value
        download.save_as(EXCEL_PATH)

        if not EXCEL_PATH.exists() or EXCEL_PATH.stat().st_size < 1000:
            raise RuntimeError("Excel no descargado o es demasiado pequeño.")

        # --- Convert to JSON ---
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
