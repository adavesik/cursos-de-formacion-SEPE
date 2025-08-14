# scraper/scrape_madrid.py
import re
from pathlib import Path
import pandas as pd
from playwright.sync_api import sync_playwright, TimeoutError as PWTimeoutError, Error as PWError

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

        # --- Select “Sí” in “Especialidad de certificado” (value="0") ---
        selected = False
        # 1) by label, if proper <label for="...">
        try:
            sel = page.get_by_label(re.compile(r"Especialidad.*certificado", re.I))
            page.wait_for_selector(sel.selector + ' >> option[value="0"]', timeout=10000)
            sel.select_option("0")
            selected = True
        except Exception:
            pass
        # 2) select following the label text
        if not selected:
            try:
                xpath = 'xpath=//label[contains(normalize-space(.),"Especialidad") and contains(.,"certificado")]/following::select[1]'
                page.wait_for_selector(xpath, timeout=10000)
                page.select_option(xpath, "0")
                selected = True
            except Exception:
                pass
        # 3) any select that contains an option value="0"
        if not selected:
            try:
                count = page.locator("select").count()
                for i in range(min(count, 15)):
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
                page.locator(sel).first.click(timeout=6000)
                buscar_clicked = True
                break
            except Exception:
                pass
        if not buscar_clicked:
            raise RuntimeError("No pude pulsar el botón Buscar.")

        # Wait for results to appear
        try:
            page.wait_for_selector("table, .tabla, .grid, .resultados", timeout=15000)
        except PWTimeoutError:
            page.wait_for_timeout(2000)

        # --- Exportar resultados a Excel ---
        # We will try both download AND response-path.
        def click_export():
            tried = 0
            for s in [
                'role=button[name=/exportar.*excel/i]',
                'button:has-text("Exportar resultados a Excel")',
                'button:has-text("Exportar a Excel")',
                'a:has-text("Exportar resultados a Excel")',
                'a:has-text("Exportar a Excel")',
                'text=/Exportar\\s+resultados\\s+a\\s+Excel/i',
            ]:
                try:
                    page.locator(s).first.click(timeout=4000)
                    tried += 1
                    return True
                except Exception:
                    pass
            return tried > 0

        if not click_export():
            raise RuntimeError("No encontré el control de 'Exportar resultados a Excel'.")

        # Try real download first
        try:
            with page.expect_download(timeout=15000) as dl:
                # click again inside the context for good measure
                click_export()
            d = dl.value
            d.save_as(EXCEL_PATH)
        except (PWTimeoutError, PWError):
            # Fallback: response path (server returns Excel directly)
            def looks_like_excel(resp):
                ct = (resp.headers.get("content-type") or "").lower()
                url = resp.url.lower()
                return (
                    "excel" in ct
                    or "spreadsheet" in ct
                    or url.endswith(".xlsx")
                    or url.endswith(".xls")
                )

            try:
                resp = page.wait_for_response(looks_like_excel, timeout=15000)
                body = resp.body()
                # ensure we have bytes
                if not body:
                    raise RuntimeError("Respuesta de export vacía.")
                EXCEL_PATH.write_bytes(body)
            except PWTimeoutError:
                raise RuntimeError("No hubo descarga ni respuesta Excel tras pulsar Exportar.")

        # Sanity check
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
