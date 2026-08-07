#!/usr/bin/env python3
"""Build the static WeChat article bundle and download its images."""

from __future__ import annotations

import argparse
import io
import json
import shutil
import time
import urllib.request
from pathlib import Path

from PIL import Image, ImageOps


FORMAT_EXTENSIONS = {
    "GIF": ".gif",
    "JPEG": ".jpg",
    "PNG": ".png",
    "WEBP": ".webp",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("input_json", type=Path)
    parser.add_argument("fallback_image", type=Path)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    return parser.parse_args()


def read_articles(path: Path) -> list[dict]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    articles = payload["result"]["value"]
    if not isinstance(articles, list):
        raise ValueError("Browser export did not contain an article list")
    return articles


def image_bytes(url: str) -> bytes:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 Chrome/138.0 Safari/537.36"
            ),
            "Referer": "https://mp.weixin.qq.com/",
        },
    )
    last_error: Exception | None = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=45) as response:
                data = response.read()
            if not data:
                raise ValueError("empty image response")
            return data
        except Exception as error:  # pragma: no cover - network retry path
            last_error = error
            if attempt < 2:
                time.sleep(attempt + 1)
    raise RuntimeError(f"Unable to download {url}: {last_error}")


def inspect_image(data: bytes) -> tuple[str, Image.Image]:
    image = Image.open(io.BytesIO(data))
    image.load()
    extension = FORMAT_EXTENSIONS.get(image.format or "", ".jpg")
    return extension, image


def write_thumbnail(image: Image.Image, path: Path) -> None:
    frame = ImageOps.exif_transpose(image)
    if getattr(frame, "is_animated", False):
        frame.seek(0)
    frame = frame.convert("RGB")
    frame.thumbnail((720, 720), Image.Resampling.LANCZOS)
    frame.save(path, format="JPEG", quality=84, optimize=True)


def prepare_fallback(root: Path, source: Path) -> tuple[str, str]:
    if not source.is_file():
        raise FileNotFoundError(f"Fallback image not found: {source}")
    posts = root / "assets" / "posts"
    thumbs = root / "assets" / "thumbs"
    posts.mkdir(parents=True, exist_ok=True)
    thumbs.mkdir(parents=True, exist_ok=True)

    full_path = posts / "wechat-fallback.png"
    thumb_path = thumbs / "wechat-fallback-thumb.jpg"
    shutil.copyfile(source, full_path)
    with Image.open(source) as image:
        write_thumbnail(image, thumb_path)
    return (
        full_path.relative_to(root).as_posix(),
        thumb_path.relative_to(root).as_posix(),
    )


def save_remote_image(root: Path, article_id: str, index: int, url: str) -> dict:
    data = image_bytes(url)
    extension, image = inspect_image(data)
    basename = f"{article_id}-{index:02d}"
    full_path = root / "assets" / "posts" / f"{basename}{extension}"
    thumb_path = root / "assets" / "thumbs" / f"{basename}-thumb.jpg"
    full_path.write_bytes(data)
    write_thumbnail(image, thumb_path)
    return {
        "src": full_path.relative_to(root).as_posix(),
        "thumb": thumb_path.relative_to(root).as_posix(),
        "alt": f"微信文章图片 {index}",
    }


def build_entries(
    root: Path,
    articles: list[dict],
    fallback_paths: tuple[str, str],
) -> list[dict]:
    entries: list[dict] = []
    seen_ids: set[str] = set()

    for article in articles:
        article_id = str(article["id"])
        if article_id in seen_ids:
            raise ValueError(f"Duplicate article id: {article_id}")
        seen_ids.add(article_id)

        searchable = "\n".join(
            str(article.get(field, "")) for field in ("title", "body", "text")
        )
        if "阿明" in searchable:
            raise ValueError(f"Forbidden article reached importer: {article['title']}")
        if not str(article.get("body", "")).strip():
            raise ValueError(f"Article has no body: {article['title']}")

        images = []
        for index, url in enumerate(article.get("remoteImages", []), start=1):
            images.append(save_remote_image(root, article_id, index, str(url)))

        if not images:
            fallback_src, fallback_thumb = fallback_paths
            images = [{
                "src": fallback_src,
                "thumb": fallback_thumb,
                "alt": "《星际穿越》书架与摄影机",
            }]

        entries.append({
            "id": article_id,
            "date": article["date"],
            "title": article["title"],
            "body": article["body"],
            "text": article["text"],
            "images": images,
            "tags": ["微信", "修行"],
            "source": article["source"],
            "notion": "",
            "favorite": False,
            "deletedAt": None,
        })

    entries.sort(key=lambda entry: (entry["date"], entry["id"]), reverse=True)
    return entries


def write_bundle(root: Path, entries: list[dict]) -> Path:
    output = root / "wechat-articles.js"
    javascript = (
        "window.BLOG_WECHAT_ARTICLES = "
        + json.dumps(entries, ensure_ascii=False, indent=2)
        + ";\n"
    )
    output.write_text(javascript, encoding="utf-8", newline="\n")
    return output


def main() -> None:
    args = parse_args()
    root = args.root.resolve()
    articles = read_articles(args.input_json.resolve())
    fallback_paths = prepare_fallback(root, args.fallback_image.resolve())
    entries = build_entries(root, articles, fallback_paths)
    output = write_bundle(root, entries)
    image_count = sum(len(entry["images"]) for entry in entries)
    print(f"Generated {len(entries)} entries and {image_count} images in {output}.")


if __name__ == "__main__":
    main()
