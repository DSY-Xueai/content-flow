from pathlib import Path
from urllib.parse import parse_qs, urlparse

from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
SELECTED_SHOT = ROOT / "test-results" / "a2-selected.png"
SOURCES_SHOT = ROOT / "test-results" / "a2-sources.png"

PNG_BYTES = bytes.fromhex(
    "89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de"
    "0000000c4944415408d763f8ffff3f0005fe02fea73581e70000000049454e44ae426082"
)


def feed_payload(url: str) -> dict:
    parsed = urlparse(url)
    query = parse_qs(parsed.query)
    is_next_page = "cursorAt" in query
    keyword = query.get("q", [""])[0]
    category = query.get("category", [""])[0]
    suffix = f" · {keyword}" if keyword else ""
    category_text = f" · {category}" if category else ""

    if is_next_page:
        return {
            "items": [
                {
                    "id": "feed-2",
                    "title": "下一页：开源模型评测框架更新",
                    "url": "https://x.com/OpenAI/status/222",
                    "source": "AI Lab",
                    "summary": "第二页内容用于验证分页按钮和列表追加。",
                    "publishedAt": "2026-05-23T01:20:00.000Z",
                    "category": "paper",
                    "score": 81,
                    "tags": ["评测", "开源"],
                    "reason": "补充验证分页行为。",
                    "media": [],
                }
            ],
            "hasNext": False,
            "nextCursor": None,
        }

    return {
        "items": [
            {
                "id": "feed-1",
                "title": f"OpenAI 发布新的 Agent 工具{suffix}{category_text}",
                "url": "https://x.com/OpenAI/status/111",
                "source": "OpenAI Blog",
                "summary": "面向开发者的 Agent 工作流能力更新，用于验证长文本、标签和推荐理由。",
                "publishedAt": "2026-05-24T01:48:00.000Z",
                "category": "ai-models",
                "score": 92,
                "tags": ["Agent", "OpenAI", "工具"],
                "reason": "开发者关注度高，适合进入今日选题池。",
                "media": [
                    {
                        "url": "https://pbs.twimg.com/media/openai-demo.jpg",
                        "type": "photo",
                        "width": 1200,
                        "height": 800,
                    },
                    {
                        "url": "https://pbs.twimg.com/media/video-cover.jpg",
                        "type": "video",
                        "width": 1200,
                        "height": 675,
                    },
                ],
            }
        ],
        "hasNext": True,
        "nextCursor": {"at": 1778206977716, "id": "cursor-demo"},
    }


def x_payload(url: str) -> dict:
    parsed = urlparse(url)
    handles_raw = parse_qs(parsed.query).get("handles", [""])[0]
    handles = [handle for handle in handles_raw.split(",") if handle]
    items = []
    for handle in handles:
        if handle.lower() == "geminiapp":
            items.append(
                {
                    "handle": handle,
                    "displayName": "Gemini App",
                    "profileUrl": f"https://x.com/{handle}",
                    "latestPost": {
                        "id": "333",
                        "text": "Gemini video demo",
                        "translatedText": "Gemini 视频演示",
                        "createdAt": "2026-05-24T02:00:00.000Z",
                        "url": f"https://x.com/{handle}/status/333",
                        "media": [
                            {
                                "url": "https://pbs.twimg.com/media/gemini-video.jpg",
                                "type": "video",
                                "videoUrl": "https://video.twimg.com/amplify_video/demo.m3u8",
                            }
                        ],
                    },
                }
            )
        elif handle.lower() in {"openai", "huggingface"}:
            items.append(
                {
                    "handle": handle,
                    "displayName": handle,
                    "profileUrl": f"https://x.com/{handle}",
                    "latestPost": {
                        "id": f"{handle}-latest",
                        "text": f"{handle} latest post",
                        "translatedText": f"{handle} 最新发布",
                        "createdAt": "2026-05-24T03:00:00.000Z",
                        "url": f"https://x.com/{handle}/status/444",
                        "media": [
                            {
                                "url": f"https://pbs.twimg.com/media/{handle}.jpg",
                                "type": "photo",
                            }
                        ],
                    },
                }
            )
    return {"items": items}


def assert_no_bad_text(page) -> None:
    body_text = page.locator("body").inner_text()
    for bad in ("�", "绮鹃", "鍔", "鏉ユ簮", "涓婚"):
        assert bad not in body_text, f"garbled text marker found: {bad}"


def assert_no_overflow(page, width: int) -> None:
    page.set_viewport_size({"width": width, "height": 1000})
    page.wait_for_timeout(250)
    overflow = page.evaluate("document.documentElement.scrollWidth > window.innerWidth + 1")
    assert not overflow, f"horizontal overflow at {width}px"


def assert_a2_visual_language(page) -> None:
    tokens = page.evaluate(
        """() => {
            const style = getComputedStyle(document.documentElement);
            const cardStyle = getComputedStyle(document.querySelector('.news-card'));
            const categoryStyle = getComputedStyle(document.querySelector('.category-list button.active'));
            const pillStyle = getComputedStyle(document.querySelector('.card-meta .category-pill'));
            const heroStyle = getComputedStyle(document.querySelector('.dashboard-hero'));
            const activeTabStyle = getComputedStyle(document.querySelector('.nav-tabs button.active'));
            const warmNeedles = [
                '255, 249, 243',
                '255, 250, 246',
                '255, 240, 226',
                '184, 111, 45',
                '196, 111, 47',
                '#fff9f3',
                '#fffaf6',
                '#fff0e2'
            ];
            const warmFields = {
                categoryBackground: categoryStyle.backgroundColor + ' ' + categoryStyle.backgroundImage,
                pillBackground: pillStyle.backgroundColor + ' ' + pillStyle.backgroundImage,
                heroBackground: heroStyle.backgroundColor + ' ' + heroStyle.backgroundImage,
                activeTabBackground: activeTabStyle.backgroundColor + ' ' + activeTabStyle.backgroundImage
            };
            return {
                bg: style.getPropertyValue('--bg').trim(),
                surface: style.getPropertyValue('--surface').trim(),
                topbar: style.getPropertyValue('--navy').trim(),
                copper: style.getPropertyValue('--copper').trim(),
                cardColumns: cardStyle.gridTemplateColumns,
                cardBackground: cardStyle.backgroundColor,
                warmFields,
                warmHits: Object.entries(warmFields)
                    .filter(([, value]) => warmNeedles.some((needle) => value.includes(needle)))
                    .map(([key, value]) => `${key}: ${value}`)
            };
        }"""
    )
    assert tokens["bg"] in {"#f5f7fb", "#f6f8fb"}, f"background is not cool AI workbench gray: {tokens}"
    assert tokens["surface"] in {"#ffffff", "#fbfdff"}, f"surface is not clean white: {tokens}"
    assert tokens["topbar"] in {"#071426", "#081527"}, f"topbar token is not deep navy: {tokens}"
    assert tokens["copper"] in {"#a65d2e", "#9a5a2e"}, f"copper accent token changed unexpectedly: {tokens}"
    assert " " in tokens["cardColumns"] and tokens["cardColumns"] != "none", f"news card is still a plain stacked card: {tokens}"
    assert tokens["warmHits"] == [], f"large warm fills still make the page read yellow: {tokens}"


def main() -> None:
    SELECTED_SHOT.parent.mkdir(exist_ok=True)
    call_counts = {"feed": 0, "x": 0}

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 1000})

        def handle_route(route):
            url = route.request.url
            if "/api/public/feed" in url:
                call_counts["feed"] += 1
                route.fulfill(json=feed_payload(url))
                return
            if "/api/public/daily" in url:
                route.fulfill(
                    json={
                        "date": "2026-05-24",
                        "lead": {
                            "title": "今日 AI HOT",
                            "leadParagraph": "日报用于验证 A2 视觉系统下的长文本和分组阅读。",
                        },
                        "sections": [
                            {
                                "label": "模型与工具",
                                "items": [
                                    {
                                        "title": "Claude 工具链更新",
                                        "summary": "分组条目摘要展示。",
                                        "sourceName": "Anthropic",
                                        "sourceUrl": "https://example.com",
                                    }
                                ],
                            }
                        ],
                    }
                )
                return
            if "/api/x/latest" in url:
                call_counts["x"] += 1
                route.fulfill(json=x_payload(url))
                return
            if "/api/img-proxy" in url:
                route.fulfill(body=PNG_BYTES, content_type="image/png")
                return
            route.continue_()

        page.route("**/*", handle_route)
        page.goto("http://127.0.0.1:5177", wait_until="domcontentloaded")

        expect(page.get_by_text("派小芯")).to_be_visible()
        expect(page.get_by_role("heading", name="精选")).to_be_visible()
        expect(page.locator(".news-card")).to_have_count(1, timeout=10000)
        expect(page.locator(".media-cell")).to_have_count(2)
        expect(page.locator(".media-cell img").first).to_have_js_property("complete", True)
        assert_no_bad_text(page)
        assert_a2_visual_language(page)
        page.screenshot(path=str(SELECTED_SHOT), full_page=True)

        page.get_by_label("搜索 AI 动态").fill("Claude")
        page.get_by_label("搜索 AI 动态").press("Enter")
        expect(page.get_by_text("OpenAI 发布新的 Agent 工具 · Claude")).to_be_visible(timeout=10000)
        page.get_by_role("button", name="刷新").click()
        expect(page.locator(".news-card")).to_have_count(1, timeout=10000)
        page.get_by_role("button", name="论文").click()
        expect(page.get_by_role("button", name="加载更多，已载入 1 条")).to_be_visible()
        page.get_by_role("button", name="加载更多，已载入 1 条").click()
        expect(page.get_by_text("下一页：开源模型评测框架更新")).to_be_visible(timeout=10000)

        page.get_by_role("button", name=re.compile("播放视频")).first.click()
        expect(page.locator(".player-dialog")).to_be_visible(timeout=10000)
        expect(page.locator("iframe.player-frame")).to_be_visible(timeout=10000)
        page.get_by_role("button", name="关闭").click()
        expect(page.locator(".player-dialog")).not_to_be_visible()

        page.get_by_role("button", name="AI 日报").click()
        expect(page.get_by_text("今日 AI HOT")).to_be_visible(timeout=10000)
        page.get_by_role("button", name="Agent 接入").click()
        expect(page.get_by_text("本页保留目标站同类入口")).to_be_visible(timeout=10000)

        page.get_by_role("button", name="特定来源").click()
        expect(page.get_by_label("X 账号链接或 handle")).to_be_visible(timeout=10000)
        expect(page.locator("[data-testid='specific-source-row']")).to_have_count(18, timeout=10000)
        expect(page.get_by_text("OpenAI 最新发布")).to_be_visible(timeout=10000)
        expect(page.get_by_text("Gemini 视频演示")).to_be_visible(timeout=10000)
        page.get_by_label("X 账号链接或 handle").fill("@huggingface")
        page.get_by_label("X 账号链接或 handle").press("Enter")
        expect(page.locator("[data-testid='specific-source-row']")).to_have_count(19, timeout=10000)
        expect(page.get_by_text("huggingface 最新发布")).to_be_visible(timeout=10000)

        page.locator(".source-media-button").first.click()
        expect(page.locator(".player-dialog")).to_be_visible(timeout=10000)
        expect(page.locator("video.player-video")).to_be_visible(timeout=10000)
        page.get_by_role("button", name="关闭").click()
        expect(page.locator(".player-dialog")).not_to_be_visible()
        page.screenshot(path=str(SOURCES_SHOT), full_page=True)

        for width in (1440, 1024, 768, 375):
            assert_no_overflow(page, width)

        assert call_counts["feed"] >= 4
        assert call_counts["x"] >= 2
        assert_no_bad_text(page)
        browser.close()


if __name__ == "__main__":
    import re

    main()
