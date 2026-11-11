"""Deterministic browser regression for the reading UI and publishing controls.

Run with the dev server on port 5177: python scripts/redesign_check.py.
API fixtures keep publishing and paid model calls out of this visual check.
"""
import json
import re
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

from playwright.sync_api import expect, sync_playwright

OUTPUT = Path(__file__).resolve().parents[1] / "test-results"
ITEMS = [
    {
        "id": str(index),
        "title": title,
        "summary": "这是用于界面回归的测试资讯，验证中文排版、来源链接和素材收集。" * 3,
        "source": {"name": "测试来源"},
        "links": {"original": f"https://example.com/{index}", "aihot": f"https://aihot.news/items/{index}"},
        "category": category,
        "score": 80,
        "reason": "验证长内容在不同屏幕尺寸下正常换行。",
        "publishedAt": date,
    }
    for index, (title, category, date) in enumerate([
        ("测试资讯：模型更新与开发者工作流", "ai-models", "2026-11-03T08:00:00Z"),
        ("测试资讯：如何验证中文界面和键盘导航", "opinion", "2026-11-03T01:00:00Z"),
        ("测试资讯：跨日期分页与资讯归档", "paper", "2026-11-02T08:00:00Z"),
    ])
]
JOB = {
    "id": "visual-test", "topic": "界面回归测试", "status": "waiting_review",
    "currentStep": "review_draft", "materials": [],
    "createdAt": "2026-11-03T00:00:00Z", "updatedAt": "2026-11-03T00:00:00Z",
    "paths": {"workDir": "pipeline-output/agent/visual-test", "draftMarkdown": "draft.md"},
}
TOPICS = {
    "groups": [{"key": "company", "name": "公司与模型", "blurb": "测试公司主题"}],
    "topics": [{"slug": "openai", "name": "OpenAI / ChatGPT", "group": "company", "definition": "测试主题定义", "brand": None, "total": 40, "recent": 5, "latest": {"title": ITEMS[0]["title"], "at": "2026-11-03T08:00:00Z"}}],
}
BOARDS = {
    "run": {"generatedAt": "2026-11-03T08:00:00Z", "methodologyVersion": "test", "fx": {"rate": 5, "asOf": "2026-11-03", "sourceName": "测试汇率"}},
    "models": {slug: {"model": {"slug": slug, "name": name, "provider": provider, "releasedAt": "2026-11-01", "aliases": [], "brand": None}, "price": {"currency": currency, "input": price, "output": price * 2, "cached": None, "inputCny": price if currency == "CNY" else price * 5, "outputCny": price * 2 if currency == "CNY" else price * 10, "cachedCny": None, "officialUrl": "https://example.com/prices", "note": "测试价格条件"}, "access": {"domestic": domestic, "weightsUrl": "https://example.com/weights" if domestic else None}} for slug, name, provider, currency, price, domestic in [("alpha", "测试模型 Alpha", "Provider A", "USD", 4, False), ("beta", "测试模型 Beta", "Provider B", "CNY", 10, True)]},
    "boards": [{"board": {"key": key, "name": name, "description": "测试第三方评测", "howToRead": "评分不是正确率。", "sourceCount": 10, "operatorCount": 3}, "entries": [{"slug": "alpha", "rank": 1, "score": 75, "coverage": 1, "sourceCount": 10}, {"slug": "beta", "rank": 2, "score": 70, "coverage": .8, "sourceCount": 8}], "filterEntries": [], "pending": []} for key, name in [("overall", "综合"), ("coding", "编程")]],
}
RESETS = {
    "today": "2026-11-03", "checkedAt": "2026-11-03T08:00:00+08:00", "count": 1,
    "events": [{"id": "confirmed-credit", "type": "reset_credit", "displayLabel": "重置卡发放", "title": "重置卡已发放", "scope": "测试用户", "status": "confirmed", "confirmedAt": "2026-11-02T07:27:00+08:00", "createdAt": "2026-11-02T07:00:00+08:00", "updatedAt": "2026-11-02T07:27:00+08:00", "occurredOn": None, "confirmationBasis": "source_post", "presentation": {"status": "confirmed", "scopeLabel": "测试用户"}, "estimate": None, "schedule": None, "posts": [{"id": "post-1", "publishedAt": "2026-11-02T07:27:00+08:00", "stage": "确认发卡", "text": "测试重置卡确认消息", "originalText": "Test reset credit confirmation", "url": "https://x.com/thsottiaux/status/123"}]}],
    "monitor": {"status": "healthy", "lastAttemptAt": "2026-11-03T08:00:00+08:00", "lastCollectedAt": "2026-11-03T08:00:00+08:00", "lastVerifiedAt": "2026-11-03T08:00:00+08:00", "pendingCount": 0, "heldWindowCount": 0, "reviewCount": 0},
}


def main():
    OUTPUT.mkdir(exist_ok=True)
    state = {"materials": [], "handles": [], "job": dict(JOB), "draft": "# 测试草稿\n\n验证编辑、保存和修改意见。", "feed_error": False, "feature_error": False}
    actions = []
    errors = []
    cases = []

    def api(route):
        request = route.request
        parsed = urlparse(request.url)
        path = parsed.path
        query = parse_qs(parsed.query)
        data = request.post_data_json if request.post_data else {}
        status = 200
        if state["feature_error"] and path == "/api/site/leaderboard/boards":
            route.fulfill(status=503, json={"error": "测试模型榜上游不可用"})
            return
        if path == "/api/v1/items":
            if state["feed_error"]:
                route.fulfill(status=503, json={"error": "测试上游不可用"})
                return
            body = {"items": ITEMS, "page": {"hasMore": False, "nextCursor": None}}
        elif path == "/api/site/topics":
            body = TOPICS
        elif path.startswith("/api/site/topics/"):
            body = {"topic": TOPICS["topics"][0], "items": ITEMS, "page": int(query.get("page", ["1"])[0]), "pageCount": 2, "modules": {}}
        elif path == "/api/site/leaderboard/boards":
            body = BOARDS
        elif path == "/api/v1/codex-resets":
            body = RESETS
        elif path == "/api/v1/dailies/latest":
            body = {"report": {"date": "2026-11-03", "lead": {"title": "测试日报：今日要闻", "leadParagraph": "验证日报导读和来源链接。"}, "sections": [{"label": "行业动态", "items": [ITEMS[0]]}]}}
        elif path == "/api/x/handles":
            if request.method == "PUT":
                state["handles"] = data["handles"]
            body = {"handles": state["handles"]}
        elif path == "/api/x/latest":
            handles = query.get("handles", [""])[0].split(",")
            body = {"items": [{"handle": handle, "displayName": handle, "profileUrl": f"https://x.com/{handle}", "latestPost": {"id": handle, "text": "测试 X 账号的中文动态。", "createdAt": "2026-11-03T01:00:00Z", "url": f"https://x.com/{handle}/status/123", "media": []}} for handle in handles]}
        elif path.startswith("/api/agent/materials"):
            if request.method == "POST":
                item = data["item"]
                title = item.get("title", item.get("displayName", "测试素材"))
                item_id = item.get("id", item.get("handle", "test").lower())
                state["materials"].append({"id": f"{data['sourceType']}:{item_id}", "sourceType": data["sourceType"], "title": title, "summary": item.get("summary", "测试素材摘要"), "addedAt": "2026-11-03T00:00:00Z"})
            elif request.method == "DELETE":
                material_id = unquote(path.rsplit("/", 1)[-1])
                state["materials"] = [item for item in state["materials"] if item["id"] != material_id] if material_id != "materials" else []
            body = {"materials": state["materials"]}
        elif path == "/api/agent/current-job":
            body = {"job": state["job"]}
        elif path == "/api/agent/history":
            body = {"history": []}
        elif path.endswith("/logs"):
            body = {"logs": [{"at": "2026-11-03T00:00:00Z", "level": "info", "step": "review_draft", "message": "等待用户确认草稿"}]}
        elif path.endswith("/draft"):
            body = {"markdown": state["draft"]}
        elif path.startswith("/api/agent/jobs") and request.method == "POST":
            action = path.rsplit("/", 1)[-1]
            actions.append(action)
            if action == "save-draft":
                state["draft"] = data["markdown"]
            elif action == "regenerate-draft":
                state["draft"] = "# 按修改意见重新生成的测试草稿"
            elif action == "stop":
                state["job"]["status"] = "stopped"
            elif action == "resume":
                state["job"].update(status="running", currentStep="generate_draft")
            elif action == "confirm-draft":
                state["job"].update(status="completed", currentStep="completed")
            elif action == "jobs":
                state["job"] = dict(JOB)
                state["draft"] = data.get("markdown", state["draft"])
            body = {"job": state["job"]}
        else:
            raise AssertionError(f"Unexpected test API: {request.method} {path}")
        route.fulfill(status=status, json=body)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 1000}, color_scheme="light")
        page.route(re.compile(r"http://127\.0\.0\.1:5177/api/"), api)
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto("http://127.0.0.1:5177", wait_until="networkidle")
        expect(page.locator(".news-card")).to_have_count(3)
        expect(page.locator("a[href*='github.com']")).to_have_count(0)
        page.get_by_role("button", name=f"加入素材：{ITEMS[0]['title']}", exact=True).click()
        expect(page.get_by_role("button", name=f"已加入素材：{ITEMS[0]['title']}", exact=True)).to_be_disabled()
        page.get_by_role("button", name=f"收藏：{ITEMS[0]['title']}", exact=True).click()

        views = [("精选", ".feed-list"), ("全部 AI 动态", ".feed-list"), ("AI 日报", ".daily-panel"), ("主题", ".topic-grid"), ("收藏", ".bookmarks-panel"), ("模型榜", ".ranking-table"), ("Tibo 重置监控", ".reset-calendar"), ("Agent 接入", ".draft-review"), ("特定来源", ".source-list")]
        for width, height in ((1440, 900), (1024, 900), (768, 900), (375, 812), (320, 568)):
            page.set_viewport_size({"width": width, "height": height})
            for theme, label in (("light", "浅色模式"), ("dark", "深色模式")):
                page.get_by_role("button", name=label, exact=True).click()
                expect(page.locator("html")).to_have_attribute("data-theme", theme)
                if width < 700 and page.get_by_role("button", name="收起侧栏", exact=True).count():
                    page.get_by_role("button", name="收起侧栏", exact=True).click()
                for index, (name, selector) in enumerate(views):
                    page.get_by_role("button", name=name, exact=True).click()
                    expect(page.locator(selector)).to_be_visible()
                    page.wait_for_load_state("networkidle")
                    overflow = page.evaluate("document.documentElement.scrollWidth > innerWidth + 1")
                    assert not overflow, (width, theme, name)
                    hidden = page.locator(".content button:visible").evaluate_all("els => els.filter(e => {const r=e.getBoundingClientRect();return r.width>0 && (r.right>innerWidth+1 || r.left<0)}).map(e=>e.textContent)")
                    assert not hidden, (width, theme, name, hidden)
                    page.screenshot(path=str(OUTPUT / f"ui-{width}-{theme}-{index}.png"))
                    cases.append({"width": width, "theme": theme, "view": name, "overflow": False})
                print(f"PASS {width}px {theme}: all {len(views)} views", flush=True)

        page.set_viewport_size({"width": 375, "height": 812})
        page.get_by_role("button", name="展开侧栏", exact=True).click()
        page.locator(".theme-switch button").last.focus()
        page.keyboard.press("Tab")
        expect(page.get_by_role("button", name="收起侧栏", exact=True)).to_be_focused()
        page.keyboard.press("Escape")
        expect(page.get_by_role("button", name="展开侧栏", exact=True)).to_be_focused()
        page.reload(wait_until="networkidle")
        expect(page.locator("#workspace-sidebar")).to_have_attribute("data-collapsed", "true")
        page.get_by_role("button", name="跟随系统", exact=True).click()
        page.emulate_media(color_scheme="dark", reduced_motion="reduce")
        expect(page.locator("html")).to_have_attribute("data-theme", "dark")
        page.emulate_media(color_scheme="light")
        expect(page.locator("html")).to_have_attribute("data-theme", "light")

        page.get_by_role("button", name="主题", exact=True).click()
        page.locator(".topic-card").first.click()
        expect(page.locator(".topic-intro")).to_be_visible()
        page.get_by_role("button", name="下一页", exact=True).click()
        expect(page.get_by_text("第 2 / 2 页", exact=True)).to_be_visible()
        page.get_by_role("button", name="← 全部主题", exact=True).click()
        expect(page.locator(".topic-grid")).to_be_visible()

        page.get_by_role("button", name="收藏", exact=True).click()
        expect(page.locator(".bookmarks-panel .news-card")).to_have_count(1)
        with page.expect_download() as downloading:
            page.get_by_role("button", name="导出收藏", exact=True).click()
        backup = OUTPUT / "bookmarks-backup.json"
        downloading.value.save_as(str(backup))
        assert len(json.loads(backup.read_text(encoding="utf-8"))["bookmarks"]) == 1
        page.locator(".bookmarks-panel .bookmark-action").first.click()
        expect(page.get_by_role("heading", name="还没有收藏", exact=True)).to_be_visible()
        page.get_by_label("导入收藏文件", exact=True).set_input_files(str(backup))
        expect(page.locator(".bookmarks-panel .news-card")).to_have_count(1)

        page.get_by_role("button", name="模型榜", exact=True).click()
        page.get_by_role("button", name="编程", exact=True).click()
        page.get_by_label("国产模型", exact=True).check()
        page.get_by_label("开放权重", exact=True).check()
        expect(page.locator(".ranking-table tbody tr")).to_have_count(1)
        page.get_by_label("价格单位", exact=True).select_option("USD")
        expect(page.locator(".mobile-price")).to_contain_text("$2")
        page.get_by_role("button", name="测试模型 Beta", exact=True).click()
        expect(page.get_by_role("dialog")).to_be_visible()
        page.keyboard.press("Escape")
        expect(page.get_by_role("dialog")).to_have_count(0)
        page.get_by_role("button", name="榜单斩杀线", exact=True).click()
        expect(page.locator(".frontier-chart")).to_be_visible()

        page.get_by_role("button", name="Tibo 重置监控", exact=True).click()
        page.get_by_role("button", name="最近记录", exact=True).click()
        expect(page.locator(".reset-day-details .reset-record")).to_have_count(1)
        page.get_by_role("button", name="2026-11-02，1 条记录", exact=True).click()
        expect(page.locator(".reset-day-details a[href='https://x.com/thsottiaux/status/123']")).to_be_visible()
        page.get_by_role("button", name="上个月", exact=True).click()
        expect(page.get_by_role("heading", name="2026 年 10 月", exact=True)).to_be_visible()

        page.get_by_role("button", name="Agent 接入", exact=True).click()
        draft = page.get_by_label("草稿 Markdown", exact=True)
        draft.fill("# 手动编辑的测试草稿")
        page.get_by_role("button", name="保存草稿", exact=True).click()
        expect(draft).to_have_value("# 手动编辑的测试草稿")
        page.get_by_role("button", name=f"移除素材：{ITEMS[0]['title']}", exact=True).click()
        expect(page.locator(".agent-material")).to_have_count(0)
        page.get_by_role("button", name="本地 Markdown", exact=True).click()
        page.get_by_label("本地 Markdown 文件", exact=True).set_input_files({"name": "test.md", "mimeType": "text/markdown", "buffer": "# 导入草稿\n\n测试内容".encode()})
        page.get_by_role("button", name="开始发文", exact=True).click()
        expect(draft).to_have_value("# 导入草稿\n\n测试内容")

        state["job"].update(status="running", currentStep="generate_draft")
        page.reload(wait_until="networkidle")
        page.get_by_role("button", name="Agent 接入", exact=True).click()
        page.get_by_role("button", name="停止任务", exact=True).click()
        expect(page.get_by_role("button", name="继续任务", exact=True)).to_be_visible()
        page.get_by_role("button", name="继续任务", exact=True).click()
        expect(page.get_by_role("button", name="停止任务", exact=True)).to_be_visible()
        assert {"save-draft", "jobs", "stop", "resume"}.issubset(actions), actions

        state["feed_error"] = True
        page.get_by_role("button", name="精选", exact=True).click()
        expect(page.get_by_role("heading", name="信息源暂时不可用", exact=True)).to_be_visible()
        state["feed_error"] = False
        page.get_by_role("button", name="刷新", exact=True).click()
        expect(page.locator(".news-card")).to_have_count(3)
        state["feature_error"] = True
        page.reload(wait_until="networkidle")
        page.get_by_role("button", name="模型榜", exact=True).click()
        expect(page.get_by_role("heading", name="暂时无法同步", exact=True)).to_be_visible()
        state["feature_error"] = False
        page.reload(wait_until="networkidle")
        page.get_by_role("button", name="模型榜", exact=True).click()
        expect(page.locator(".ranking-table")).to_be_visible()
        assert not errors, errors
        (OUTPUT / "redesign-report.json").write_text(json.dumps({"cases": cases, "actions": actions, "javascriptErrors": errors}, ensure_ascii=False, indent=2), encoding="utf-8")
        browser.close()
        print("PASS responsive matrix, topic pages, bookmark backup/restore, model filters/prices/dialog/chart, reset calendar, theme/keyboard, publishing controls and error recovery")


if __name__ == "__main__":
    main()
