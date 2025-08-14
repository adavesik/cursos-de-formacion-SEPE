# scraper/scrape_madrid.py
import re
from pathlib import Path
import pandas as pd
from playwright.sync_api import sync_playwright, TimeoutError as PWTimeoutError

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
DEBUG = ROOT / "debug"
PUBLIC.mkdir(parents=True, exist_ok=True)
DEBUG.mkdir(parents=True, exist_ok=True)

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

def click_cookie_consent(page):
    # Try common Spanish consent buttons
    selectors = [
        'button:has-text("Aceptar")',
        'button:has-text("Aceptar todas")',
        'text=/Aceptar( todas)? las cookies/i',
        'role=button[name=/Aceptar/i]',
    ]
    for s in selectors:
        try:
            el = page.locator(s).first
            if el.is_visible():
                el.click(timeout=2000)
                page.wait_for_timeout(500)
                return True
        except Exception:
            pass
    return False

def run():
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True, args=["--no-sandbox"])
        ctx = browser.new_context(accept_downloads=True)
        page = ctx.new_page()
        page.goto(URL, wait_until="domcontentloaded")

        # Cookie banners (best effort)
        click_cookie_consent(page)

        # Try to select “Sí” for Especialidad de certificado
        selected = False
        try:
            page.get_by_label(re.compile(r"Especialidad.*certificado", re.I)).select_option(
                label=re.compile(r"^s[ií]$", re.I), timeout=5000
            )
            selected = True
        except Exception:
            # Fallback: brute-force look through selects
            try:
                sel_count = page.locator("select").count()
                for i in range(min(sel_count, 10)):
                    try:
                        page.locator("select").nth(i).select_option(label=re.compile(r"^s[ií]$", re.I), timeout=1000)
                        selected = True
                        break
                    except Exception:
                        pass
            except Exception:
                pass

        if not selected:
            page.screenshot(path=str(DEBUG / "00_no_select.png"))
            html = page.content()
            (DEBUG / "00_no_select.html").write_text(html, encoding="utf-8")
            raise RuntimeError("No pude seleccionar 'Sí' en 'Especialidad de certificado'.")

        # Click Buscar
        buscar_clicked = False
        for sel in [
            'role=button[name=/^buscar$/i]',
            'button:has-text("Buscar")',
            'input[type="submit"][value*="Buscar"]',
            'text=/^Buscar$/',
        ]:
            try:
                page.locator(sel).first.click(timeout=4000)
                buscar_clicked = True
                break
            except Exception:
                pass

        if not buscar_clicked:
            page.screenshot(path=str(DEBUG / "01_no_buscar.png"))
            (DEBUG / "01_no_buscar.html").write_text(page.content(), encoding="utf-8")
            raise RuntimeError("No pude pulsar el botón Buscar.")

        # Wait for results: any table or grid; give it time
        try:
            page.wait_for_selector("table, .tabla, .grid, .resultados", timeout=15000)
        except PWTimeoutError:
            # Capture state for debugging
            page.screenshot(path=str(DEBUG / "02_no_resultados.png"), full_page=True)
            (DEBUG / "02_no_resultados.html").write_text(page.content(), encoding="utf-8")
            raise RuntimeError("No aparecieron resultados tras Buscar.")

        # Exportar a Excel (button or link)
        download = None
        try:
            with page.expect_download(timeout=30000) as dl:
                try:
                    page.get_by_role("button", name=re.compile(r"exportar.*excel", re.I)).click()
                except Exception:
                    # Try anchor link variants
                    locs = [
                        'a:has-text("Exportar resultados a Excel")',
                        'a:has-text("Exportar a Excel")',
                        'text=/Exportar\\s+resultados\\s+a\\s+Excel/i',
                    ]
                    clicked = False
                    for l in locs:
                        try:
                            page.locator(l).first.click(timeout=3000)
                            clicked = True
                            break
                        except Exception:
                            pass
                    if not clicked:
                        raise RuntimeError("No encontré el control de Exportar a Excel.")
            download = dl.value
        except Exception as e:
            page.screenshot(path=str(DEBUG / "03_no_export.png"), full_page=True)
            (DEBUG / "03_no_export.html").write_text(page.content(), encoding="utf-8")
            raise

        # Save the downloaded file
        download.save_as(EXCEL_PATH)

        if not EXCEL_PATH.exists() or EXCEL_PATH.stat().st_size < 1000:
            page.screenshot(path=str(DEBUG / "04_excel_vacio.png"), full_page=True)
            raise RuntimeError("Excel no descargado o es demasiado pequeño.")

        # Convert to JSON
        df = pd.read_excel(EXCEL_PATH)
        if df.empty:
            raise RuntimeError("Excel descargado pero sin filas.")
        df = normalize_cols(df)
        df.to_json(JSON_PATH, orient="records", force_ascii=False)

        # Debug prints
        print(f"OK → {EXCEL_PATH} ({EXCEL_PATH.stat().st_size} bytes)")
        print(f"OK → {JSON_PATH} ({JSON_PATH.stat().st_size} bytes)")

        ctx.close(); browser.close()

if __name__ == "__main__":
    run()
