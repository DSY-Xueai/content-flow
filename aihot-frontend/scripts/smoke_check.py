import re
from pathlib import Path
from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
SCREENSHOT = ROOT / "test-results" / "aihot-workbench.png"


def main() -> None:
    SCREENSHOT.parent.mkdir(exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        page.route("**/api/x/**", lambda route: route.fulfill(json={"handles": [], "items": []}))
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto("http://127.0.0.1:5177", wait_until="domcontentloaded")
        page.wait_for_load_state("networkidle")

        expect(page.get_by_role("heading", name="\u7cbe\u9009")).to_be_visible()
        expect(page.locator(".news-card").first).to_be_visible(timeout=20000)
        first_link = page.locator(".news-card h3 a").first
        assert first_link.get_attribute("href").startswith("https://")
        first_count = page.locator(".news-card").count()
        print(f"Selected feed: {first_count} items")

        more = page.get_by_role("button", name=re.compile("\u52a0\u8f7d\u66f4\u591a"))
        expect(more).to_be_visible()
        with page.expect_response(lambda response: "/api/v1/items?" in response.url and "cursor=" in response.url) as next_page:
            more.click()
        assert next_page.value.status == 200
        page.wait_for_function("count => document.querySelectorAll('.news-card').length > count", arg=first_count)
        print(f"Pagination: {page.locator('.news-card').count()} items")

        with page.expect_response(lambda response: "/api/v1/items?mode=all" in response.url) as all_response:
            page.get_by_role("button", name="\u5168\u90e8 AI \u52a8\u6001", exact=True).click()
        assert all_response.value.status == 200
        expect(page.locator(".news-card").first).to_be_visible(timeout=20000)
        print("All feed: HTTP 200")

        search = page.get_by_label("\u641c\u7d22 AI \u52a8\u6001")
        search.fill("OpenAI")
        with page.expect_response(lambda response: "/api/v1/items?" in response.url and "q=OpenAI" in response.url) as search_response:
            search.press("Enter")
        assert search_response.value.status == 200
        expect(page.locator(".news-card").first).to_be_visible(timeout=20000)
        print("Search: HTTP 200")

        with page.expect_response(lambda response: "category=paper" in response.url) as category_response:
            page.get_by_role("button", name="\u8bba\u6587", exact=True).click()
        assert category_response.value.status == 200
        expect(page.locator(".news-card, .status-view").first).to_be_visible(timeout=20000)
        print("Category: HTTP 200")

        with page.expect_response(lambda response: "/api/v1/dailies/latest" in response.url) as daily_response:
            page.get_by_role("button", name="AI \u65e5\u62a5").click()
        assert daily_response.value.status == 200
        expect(page.locator(".daily-panel")).to_be_visible(timeout=20000)
        expect(page.locator(".daily-section article a").first).to_have_attribute("href", re.compile(r"^https://"))
        print("Daily: HTTP 200 with linked sections")

        for width in (1440, 768, 375):
            page.set_viewport_size({"width": width, "height": 1000})
            page.wait_for_timeout(200)
            overflow = page.evaluate("document.documentElement.scrollWidth > window.innerWidth + 1")
            assert not overflow, f"horizontal overflow at {width}px"

        page.screenshot(path=str(SCREENSHOT), full_page=True)
        assert not errors, errors
        print("Browser smoke check passed; no JavaScript errors")
        browser.close()


if __name__ == "__main__":
    main()
