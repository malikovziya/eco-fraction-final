"""Capture every page of the running app (for visual review) and report console errors.

Run:  .venv\\Scripts\\python frontend\\scripts\\screenshots.py <out_dir> [path ...]
"""

import sys
import time
from pathlib import Path

import httpx
from playwright.sync_api import sync_playwright

APP = "http://localhost:3000"
API = "http://127.0.0.1:8100/api"
PAGES = ["/", "/assets", "/assets/khizi-wind", "/portfolio", "/architecture", "/ai", "/explorer", "/login"]


def main() -> None:
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "screenshots")
    out.mkdir(parents=True, exist_ok=True)
    # Paths may be given without a leading slash ("assets", "home") to avoid shell path rewriting
    pages = ["/" + ("" if a == "home" else a.lstrip("/")) for a in sys.argv[2:]] or PAGES
    token = httpx.post(f"{API}/auth/persona", json={"persona": "aylin"}).json()["token"]

    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
        ctx.add_init_script(f"localStorage.setItem('eco.token', '{token}')")
        page = ctx.new_page()
        errors: list[str] = []
        page.on("console", lambda m: m.type == "error" and errors.append(f"{page.url}: {m.text}"))
        page.on("pageerror", lambda e: errors.append(f"{page.url}: {e}"))

        for path in pages:
            page.goto(APP + path, wait_until="networkidle")
            time.sleep(6)  # let live data stream in
            name = path.strip("/").replace("/", "_") or "home"
            page.screenshot(path=out / f"{name}.png", full_page=True)
            print(f"captured {path}")
        browser.close()

    print(f"\n{len(errors)} console errors")
    for e in errors[:20]:
        print(" ", e[:300])


if __name__ == "__main__":
    main()
