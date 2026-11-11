"""Live checks for the existing local service, bounded snapshots and sync status UI."""
import copy
import json
import time
from pathlib import Path
from urllib.request import urlopen
from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
BASE = "http://127.0.0.1:5177"


def health():
    with urlopen(f"{BASE}/api/aihot-sync/status", timeout=5) as response:
        return json.load(response)


deadline = time.monotonic() + 30
while True:
    initial = health()
    if all(entry["lastSuccessAt"] or entry["error"] for entry in initial["resources"]):
        break
    assert time.monotonic() < deadline, "Initial background checks did not finish"
    time.sleep(1)

for entry in initial["resources"]:
    print(f"Before opening browser: {entry['name']}: {entry['error'] or 'OK'}", flush=True)
    if entry["path"] != "/api/v1/codex-resets":
        assert entry["lastSuccessAt"] and not entry["error"], entry

cache = ROOT / "data" / "aihot-sync-cache.json"
saved = json.loads(cache.read_text(encoding="utf-8"))
assert len(saved["entries"]) == 8
assert cache.stat().st_size <= initial["cache"]["limitBytes"]
assert not Path(f"{cache}.tmp").exists()

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    page.route("**/api/x/**", lambda route: route.fulfill(json={"handles": [], "items": []}))
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(BASE, wait_until="networkidle")
    page.get_by_role("button", name="热点榜", exact=True).click()
    expect(page.get_by_role("list", name="AIHOT 热点排名")).to_be_visible()
    expect(page.get_by_label("后台同步状态", exact=True)).to_be_visible()
    expect(page.locator("details.sync-health")).to_have_count(0)
    output = ROOT / "test-results"
    output.mkdir(exist_ok=True)
    page.screenshot(path=str(output / "sync-health-live.png"), full_page=True)

    # Check the persisted-error presentation without changing the real upstream or disk snapshot.
    failure = copy.deepcopy(health())
    hot = next(entry for entry in failure["resources"] if entry["path"] == "/api/v1/hot-topics")
    hot.update(error="items[0].title 缺失或类型不符", consecutiveFailures=2, cached=True)
    page.route("**/api/aihot-sync/status", lambda route: route.fulfill(json=failure))
    page.reload(wait_until="networkidle")
    expect(page.get_by_text("同步状态：异常", exact=True)).to_be_visible()
    indicator = page.get_by_label("后台同步状态", exact=True)
    expect(indicator).to_have_css("animation-name", "sync-health-blink")
    assert "items[0].title" in indicator.get_attribute("title")
    page.emulate_media(reduced_motion="reduce")
    expect(indicator).to_have_css("animation-name", "none")
    page.emulate_media(reduced_motion="no-preference")
    page.screenshot(path=str(output / "sync-health-error.png"), full_page=True)
    page.get_by_role("button", name="深色模式", exact=True).click()
    page.get_by_role("button", name="收起侧栏", exact=True).click()
    for width in (768, 375):
        page.set_viewport_size({"width": width, "height": 1000})
        assert not page.evaluate("document.documentElement.scrollWidth > window.innerWidth + 1")
    page.screenshot(path=str(output / "sync-health-mobile.png"))
    assert not errors, errors
    browser.close()

before = next(entry for entry in health()["resources"] if entry["path"] == "/api/v1/hot-topics")["lastSuccessAt"]
print("Browser closed; waiting for a real server-side minute check...", flush=True)
deadline = time.monotonic() + 80
while True:
    current = health()
    hot = next(entry for entry in current["resources"] if entry["path"] == "/api/v1/hot-topics")
    if hot["lastSuccessAt"] > before:
        break
    assert time.monotonic() < deadline, hot
    time.sleep(2)
print("PASS: local service refreshed AIHOT after the browser was closed", flush=True)
