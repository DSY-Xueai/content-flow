from pathlib import Path
from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    page.route("**/api/x/**", lambda route: route.fulfill(json={"handles": [], "items": []}))
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.clock.install()
    page.goto("http://127.0.0.1:5177", wait_until="networkidle")
    with page.expect_response(lambda response: response.url.endswith("/api/v1/hot-topics")) as loaded:
        page.get_by_role("button", name="热点榜", exact=True).click()
    assert loaded.value.status == 200
    data = loaded.value.json()
    rows = page.locator(".hot-topics-list > li")
    expect(rows).to_have_count(data["count"])
    for index, topic in enumerate(data["items"]):
        row = rows.nth(index)
        expect(row.get_by_label(f"第 {topic['rank']} 名", exact=True)).to_have_text(f"{topic['rank']:02d}")
        expect(row.locator("h2 a")).to_have_text(topic["title"])
        expect(row.locator("h2 a")).to_have_attribute("href", topic["links"].get("story", topic["links"]["aihot"]))
    print(f"Live AIHOT ranking: HTTP 200, {data['count']} matching topics")

    with page.expect_response(lambda response: response.url.endswith("/api/v1/hot-topics")) as refreshed:
        page.clock.fast_forward(61000)
    assert refreshed.value.status in (200, 304)
    expect(page.get_by_label("信息源状态：正常", exact=True)).to_be_visible()
    print(f"Automatic minute refresh: HTTP {refreshed.value.status}")

    if data["items"]:
        title = data["items"][0]["title"]
        page.get_by_role("button", name=f"收藏：{title}", exact=True).click()
        expect(page.get_by_role("button", name=f"取消收藏：{title}", exact=True)).to_have_attribute("aria-pressed", "true")
        page.get_by_role("button", name="收藏", exact=True).click()
        expect(page.get_by_role("link", name=title, exact=True)).to_be_visible()
        page.get_by_role("button", name="热点榜", exact=True).click()
        expect(page.get_by_role("list", name="AIHOT 热点排名")).to_be_visible()

    output = ROOT / "test-results"
    output.mkdir(exist_ok=True)
    page.screenshot(path=str(output / "hot-topics-desktop.png"), full_page=True)
    page.get_by_role("button", name="深色模式", exact=True).click()
    page.screenshot(path=str(output / "hot-topics-dark.png"), full_page=True)
    page.get_by_role("button", name="收起侧栏", exact=True).click()
    for width in (768, 375):
        page.set_viewport_size({"width": width, "height": 1000})
        assert not page.evaluate("document.documentElement.scrollWidth > window.innerWidth + 1"), f"Overflow at {width}px"
    page.screenshot(path=str(output / "hot-topics-mobile.png"), full_page=True)
    assert not errors, errors
    browser.close()
    print("Hot ranking browser checks passed: bookmarks, themes, mobile layout, no JavaScript errors")
