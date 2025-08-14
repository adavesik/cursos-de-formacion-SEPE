# scraper/scrape_madrid.py
import re
from pathlib import Path
from playwright.sync_api import sync_playwright, TimeoutError as PWTimeoutError, Error as PWError

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
PUBLIC.mkdir(parents=True, exist_ok=True)

EXCEL_PATH = PUBLIC / "madrid_cursos.xlsx"
URL = "https://oficinaempleo.comunidad.madrid/BuscadorCursosPublico/"

def run():
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True, args=["--no-sandbox"])
        ctx = browser.new_context(accept_downloads=True)
        page = ctx.new_page()
        page.goto(URL, wait_until="domcontentloaded")

        # --- Select “Sí” for “Especialidad de certificado” (value="0") ---
        selected = False
        try:
            sel = page.get_by_label(re.compile(r"Especialidad.*certificado", re.I))
            page.wait_for_selector(sel.selector + ' >> option[value="0"]', timeout=10000)
            sel.select_option("0"); selected = True
        except Exception:
            pass
        if not selected:
            try:
                xpath = 'xpath=//label[contains(normalize-space(.),"Especialidad") and contains(.,"certificado")]/following::select[1]'
                page.wait_for_selector(xpath, timeout=10000)
                page.select_option(xpath, "0"); selected = True
            except Exception:
                pass
        if not selected:
            try:
                count = page.locator("select").count()
                for i in range(min(count, 15)):
                    sel_loc = page.locator("select").nth(i)
                    if sel_loc.locator('option[value="0"]').count() > 0:
                        page.select_option(sel_loc, "0"); selected = True; break
            except Exception:
                pass
        if not selected:
            raise RuntimeError("No pude seleccionar 'Sí' (value='0') en 'Especialidad de certificado'.")

        # --- Click “Buscar” ---
        buscar_clicked = False
        for s in [
            'role=button[name=/^buscar$/i]',
            'button:has-text("Buscar")',
            'input[type="submit"][value*="Buscar"]',
            'text=/^Buscar$/',
        ]:
            try:
                page.locator(s).first.click(timeout=6000); buscar_clicked = True; break
            except Exception:
                pass
        if not buscar_clicked:
            raise RuntimeError("No pude pulsar el botón Buscar.")

        # Wait for results
        try:
            page.wait_for_selector("table, .tabla, .grid, .resultados", timeout=15000)
        except PWTimeoutError:
            page.wait_for_timeout(1500)

        # --- Exportar resultados a Excel ---
        def click_export():
            for s in [
                'role=button[name=/exportar.*excel/i]',
                'button:has-text("Exportar resultados a Excel")',
                'button:has-text("Exportar a Excel")',
                'a:has-text("Exportar resultados a Excel")',
                'a:has-text("Exportar a Excel")',
                'text=/Exportar\\s+resultados\\s+a\\s+Excel/i',
            ]:
                try:
                    page.locator(s).first.click(timeout=4000); return True
                except Exception:
                    pass
            return False

        if not click_export():
            raise RuntimeError("No encontré el control de 'Exportar resultados a Excel'.")

        # Try download event first
        try:
            with page.expect_download(timeout=15000) as dl:
                click_export()
            d = dl.value
            d.save_as(EXCEL_PATH)
        except (PWTimeoutError, PWError):
            # Fallback: response that looks like an Excel file
            def looks_like_excel(resp):
                ct = (resp.headers.get("content-type") or "").lower()
                url = resp.url.lower()
                return ("excel" in ct) or ("spreadsheet" in ct) or url.endswith(".xlsx") or url.endswith(".xls")
            resp = page.wait_for_response(looks_like_excel, timeout=15000)
            body = resp.body()
            if not body:
                raise RuntimeError("Respuesta de export vacía.")
            EXCEL_PATH.write_bytes(body)

        if not EXCEL_PATH.exists() or EXCEL_PATH.stat().st_size < 1000:
            raise RuntimeError("Excel no descargado o es demasiado pequeño.")

        print(f"OK → {EXCEL_PATH} ({EXCEL_PATH.stat().st_size} bytes)")

        ctx.close(); browser.close()

if __name__ == "__main__":
    run()
