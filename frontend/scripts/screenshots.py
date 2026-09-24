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
    # "as:<persona>" switches the signed-in persona for the pages that follow
    args = sys.argv[2:] or [p.lstrip("/") or "home" for p in PAGES]
    errors: list[str] = []

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = None
        persona, lang = "aylin", "tr"
        for arg in args:
            if arg.startswith("as:") or arg.startswith("lang:"):  # switch persona / UI language
                if arg.startswith("as:"):
                    persona = arg[3:]
                else:
                    lang = arg[5:]
                page = None
                continue
            if page is None:
                token = httpx.post(f"{API}/auth/persona", json={"persona": persona}).json()["token"]
                ctx = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
                ctx.add_init_script(f"localStorage.setItem('eco.token', '{token}'); localStorage.setItem('eco.lang', '{lang}')")
                page = ctx.new_page()
                page.on("console", lambda m: m.type == "error" and errors.append(f"{m.text}"))
                page.on("pageerror", lambda e: errors.append(f"{e}"))
            path = "/" + ("" if arg == "home" else arg.lstrip("/"))
            page.goto(APP + path, wait_until="networkidle")
            time.sleep(6)  # let live data stream in
            name = path.strip("/").replace("/", "_") or "home"
            page.screenshot(path=out / f"{name}-{lang}.png", full_page=True)
            print(f"captured {path} as {persona}")
        browser.close()

    print(f"\n{len(errors)} console errors")
    for e in errors[:20]:
        print(" ", e[:300])


if __name__ == "__main__":
    main()
