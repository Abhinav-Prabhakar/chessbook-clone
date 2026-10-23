#!/usr/bin/env python3
"""Generate static Chessbook clone pages from captured DOM snapshots.

The snapshots in recon/site/html are the rendered HTML of the real app.  We keep
the rendered app subtree and the real production CSS, then layer a small
navigation/interaction script (js/boot.js) on top.  No hydration scripts run.
"""
from __future__ import annotations
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "recon", "site", "html")

HEAD = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#131516">
<title>{title}</title>
{base}
<link rel="icon" href="{prefix}favicon.ico">
<link rel="apple-touch-icon" href="{prefix}apple-touch-icon.png">
<link rel="manifest" href="{prefix}site_manifest.json">
<style>:root{{background:#131516;color:#f5f5f5;color-scheme:dark}}html,body,#app{{min-height:100%;margin:0}}</style>
<link rel="stylesheet" href="{prefix}_build/assets/entry-web-DlhHRFsU.css">
<link rel="stylesheet" href="{prefix}_build/assets/app-CxFWCbj_.css">
<script type="module" src="{prefix}js/boot.js"></script>
</head>
<body class="bg-gray-19 text-primary" data-page="{page}" data-root="{prefix}">
"""

MOBILE_HEAD = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#131516">
<title>{title}</title>
<link rel="icon" href="../favicon.ico">
<link rel="apple-touch-icon" href="../apple-touch-icon.png">
<link rel="manifest" href="../site_manifest.json">
<style>:root{{background:#131516;color:#f5f5f5;color-scheme:dark}}html,body,#app{{min-height:100%;margin:0}}</style>
<link rel="stylesheet" href="../_build/assets/entry-web-DlhHRFsU.css">
<link rel="stylesheet" href="../_build/assets/app-CxFWCbj_.css">
<script type="module" src="../js/boot.js"></script>
</head>
<body class="bg-gray-19 text-primary" data-page="{page}" data-root="./">
"""

TAIL = "</body></html>\n"

# data-testid -> route, per generated page
NAV = {
    "index.html": {
        "repertoire-white": "repertoire-white.html",
        "repertoire-black": "repertoire-black.html",
        "practice-moves": "practice-white.html",
        "connect-account": "settings.html",
    },
    "repertoire-white.html": {
        "continue-building": "build-white.html",
        "continue-learning": "learn-white.html",
    },
    "repertoire-black.html": {
        "sidebar-action-0": "build-white.html",
        "sidebar-action-1": "build-white.html",
    },
    "build-white.html": {
        "sidebar-action-0": "gap-white.html",
        "repertoire-move-row-0": "gap-white.html",
    },
    "gap-white.html": {
        "auto-fill-gap": "__autofill",
        "repertoire-move-row-0": "build-white.html",
        "repertoire-move-row-1": "build-white.html",
        "repertoire-move-row-2": "build-white.html",
        "repertoire-move-row-3": "build-white.html",
        "repertoire-move-row-4": "build-white.html",
    },
    "learn-white.html": {
        "sidebar-action-0": "practice-white.html",
        "sidebar-action-1": "practice-white.html",
        "sidebar-action-2": "practice-white.html",
        "sidebar-action-3": "practice-white.html",
    },
    "practice-white.html": {
        "sidebar-action-0": "__show-answer",
        "sidebar-action-1": "build-white.html",
        "sidebar-action-2": "learn-white.html",
    },
    "settings.html": {},
    "model.html": {},
    "add.html": {},
    "welcome.html": {"sidebar-focus-action": "index.html"},
    "login.html": {},
}

BACK = {
    "index.html": "index.html",
    "repertoire-white.html": "index.html",
    "repertoire-black.html": "index.html",
    "build-white.html": "repertoire-white.html",
    "gap-white.html": "build-white.html",
    "learn-white.html": "repertoire-white.html",
    "practice-white.html": "learn-white.html",
    "settings.html": "index.html",
    "model.html": "index.html",
    "add.html": "index.html",
    "welcome.html": "index.html",
    "login.html": "index.html",
}

TITLES = {
    "index.html": "Chessbook",
    "repertoire-white.html": "White openings · Chessbook",
    "repertoire-black.html": "Black openings · Chessbook",
    "build-white.html": "Build · Chessbook",
    "gap-white.html": "Biggest gap · Chessbook",
    "learn-white.html": "Learn · Chessbook",
    "practice-white.html": "Practice · Chessbook",
    "settings.html": "Settings · Chessbook",
    "model.html": "Model games · Chessbook",
    "add.html": "Add new repertoire · Chessbook",
}


def app_subtree(raw: str) -> str:
    start = raw.find('<div id="app"')
    if start < 0:
        raise SystemExit("missing #app")
    end = raw.find('<script id="page-data"', start)
    if end < 0:
        end = raw.rfind("</body>")
    body = raw[start:end]
    body = re.sub(r"<script.*?</script>", "", body, flags=re.S)
    return body


def rewrite_root_urls(body: str, prefix: str) -> str:
    """Make root-absolute production asset URLs work on a Pages subpath."""
    for path in ("pieces/", "_build/", "homepage_imgs/"):
        body = body.replace(f'"/{path}', f'"{prefix}{path}')
        body = body.replace(f"'/{path}", f"'{prefix}{path}")
        body = body.replace(f'&quot;/{path}', f'&quot;{prefix}{path}')
        body = body.replace(f" /{path}", f" {prefix}{path}")
        body = body.replace(f"(/{path}", f"({prefix}{path}")
        body = body.replace(f",/{path}", f",{prefix}{path}")
    body = body.replace('href="/login"', f'href="{prefix}login.html"')
    body = body.replace('href="/signup"', f'href="{prefix}signup/index.html"')
    body = body.replace('href="/privacy-policy.html"', f'href="{prefix}privacy-policy.html"')
    body = body.replace('href="/fulfillment_policy.html"', f'href="{prefix}fulfillment_policy.html"')
    return body


def rewrite_assets(body: str) -> str:
    return rewrite_root_urls(body, "")


def rewrite_assets_mobile(body: str) -> str:
    return rewrite_root_urls(body, "../")


def annotate(body: str, page: str) -> str:
    for tid, route in NAV.get(page, {}).items():
        attr = f'data-action="{route[2:]}"' if route.startswith("__") else f'data-nav="{route}"'
        token = f'data-testid="{tid}"'
        if token in body:
            body = body.replace(token, f'{token} {attr}', 1)
    if page in BACK:
        body = body.replace(
            'id="back-button"',
            f'id="back-button" data-action="back" data-back="{BACK[page]}"',
            1,
        )
    return body


def build_app(page: str, raw_name: str) -> None:
    raw = open(os.path.join(SRC, raw_name), encoding="utf-8").read()
    body = annotate(rewrite_assets(app_subtree(raw)), page)
    html = HEAD.format(
        title=TITLES.get(page, "Chessbook"),
        prefix="./",
        base="",
        page=page,
    ) + body + TAIL
    with open(os.path.join(ROOT, page), "w", encoding="utf-8") as fh:
        fh.write(html)
    print(f"{page:24s} {len(html):>8,d} bytes")


def build_auth(page: str, raw_name: str) -> None:
    raw = open(os.path.join(SRC, raw_name), encoding="utf-8").read()
    body = annotate(rewrite_assets(app_subtree(raw)), page)
    html = HEAD.format(
        title="Log in · Chessbook" if page == "login.html" else "Set up your Chessbook · Chessbook",
        prefix="./",
        base="",
        page=page,
    ) + body + TAIL
    with open(os.path.join(ROOT, page), "w", encoding="utf-8") as fh:
        fh.write(html)
    print(f"{page:24s} {len(html):>8,d} bytes")


def build_marketing() -> None:
    raw = open(os.path.join(SRC, "signup-real.html"), encoding="utf-8").read()
    body = annotate(rewrite_assets(app_subtree(raw)), "signup/index.html")
    html = HEAD.format(
        title="Chessbook: Chess Opening Repertoire Builder & Trainer",
        prefix="",
        base='<base href="../">',
        page="signup/index.html",
    ) + body + TAIL
    os.makedirs(os.path.join(ROOT, "signup"), exist_ok=True)
    with open(os.path.join(ROOT, "signup", "index.html"), "w", encoding="utf-8") as fh:
        fh.write(html)
    print(f"{'signup/index.html':24s} {len(html):>8,d} bytes")


def build_mobile(page: str, raw_name: str) -> None:
    raw = open(os.path.join(SRC, raw_name), encoding="utf-8").read()
    body = annotate(rewrite_assets_mobile(app_subtree(raw)), page)
    html = MOBILE_HEAD.format(title=TITLES.get(page, "Chessbook"), page=page) + body + TAIL
    os.makedirs(os.path.join(ROOT, "m"), exist_ok=True)
    with open(os.path.join(ROOT, "m", page), "w", encoding="utf-8") as fh:
        fh.write(html)
    print(f"m/{page:22s} {len(html):>8,d} bytes")


def main() -> None:
    for page, raw_name in {
        "index.html": "dashboard.html",
        "repertoire-white.html": "repertoire-white.html",
        "repertoire-black.html": "repertoire-black.html",
        "build-white.html": "build-white.html",
        "gap-white.html": "gap-white.html",
        "learn-white.html": "learn-white.html",
        "practice-white.html": "practice-white.html",
        "settings.html": "settings.html",
        "model.html": "model.html",
        "add.html": "add.html",
    }.items():
        build_app(page, raw_name)
    for page, raw_name in {
        "index.html": "mobile-dashboard.html",
        "repertoire-white.html": "mobile-repertoire-white.html",
        "repertoire-black.html": "mobile-repertoire-black.html",
        "build-white.html": "mobile-build-white.html",
        "gap-white.html": "mobile-gap-white.html",
        "learn-white.html": "mobile-learn-white.html",
        "practice-white.html": "mobile-practice-white.html",
        "settings.html": "mobile-settings.html",
        "model.html": "mobile-model.html",
        "add.html": "mobile-add.html",
    }.items():
        build_mobile(page, raw_name)
    build_auth("welcome.html", "welcome-real.html")
    build_auth("login.html", "login-real.html")
    build_mobile("welcome.html", "mobile-welcome.html")
    build_mobile("login.html", "mobile-login.html")
    build_marketing()


if __name__ == "__main__":
    main()
