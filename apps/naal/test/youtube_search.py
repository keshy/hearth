"""Look up candidate YouTube videos for the songs in content/, so every link
in the app is a real video. Prints the top results for each query.

    python3 apps/naal/test/youtube_search.py "Kanda Sashti Kavasam Sulamangalam Sisters" ...
    python3 apps/naal/test/youtube_search.py --check VIDEO_ID ...
"""

import json
import re
import sys
import urllib.parse
import urllib.request

UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15",
      "Accept-Language": "en-US,en;q=0.9"}


def fetch(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=20) as r:
        return r.read().decode("utf-8", "replace")


def search(query, limit=4):
    html = fetch("https://www.youtube.com/results?search_query=" + urllib.parse.quote(query))
    m = re.search(r"var ytInitialData = (\{.*?\});</script>", html)
    if not m:
        return []
    data = json.loads(m.group(1))
    out = []

    def walk(node):
        if len(out) >= limit:
            return
        if isinstance(node, dict):
            v = node.get("videoRenderer")
            if v and v.get("videoId"):
                out.append({
                    "id": v["videoId"],
                    "title": "".join(r.get("text", "") for r in v.get("title", {}).get("runs", [])),
                    "channel": "".join(r.get("text", "") for r in v.get("ownerText", {}).get("runs", [])),
                    "length": v.get("lengthText", {}).get("simpleText", "live?"),
                    "views": v.get("viewCountText", {}).get("simpleText", ""),
                })
                return
            for child in node.values():
                walk(child)
        elif isinstance(node, list):
            for child in node:
                walk(child)

    walk(data)
    return out


def check(video_id):
    url = "https://www.youtube.com/oembed?format=json&url=" + urllib.parse.quote(f"https://www.youtube.com/watch?v={video_id}")
    try:
        info = json.loads(fetch(url))
        return f"{video_id}  OK  {info['title']}  ({info['author_name']})"
    except Exception as exc:  # noqa: BLE001 - report and continue
        return f"{video_id}  FAIL  {exc}"


if __name__ == "__main__":
    args = sys.argv[1:]
    if args and args[0] == "--check":
        for vid in args[1:]:
            print(check(vid))
    else:
        for q in args:
            print(f"## {q}")
            for r in search(q):
                print(f"  {r['id']}  {r['length']:>8}  {r['views']:>18}  {r['title'][:80]}  [{r['channel']}]")
