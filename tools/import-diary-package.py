#!/usr/bin/env python3
"""Import a structured diary package into the static blog."""

from __future__ import annotations

import argparse
import html
import json
import shutil
from pathlib import Path

from PIL import Image, ImageOps


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("package_dir", type=Path)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    return parser.parse_args()


def dated_title(date: str) -> str:
    year, month, day = (int(part) for part in date.split("-"))
    return f"【{year}年{month}月{day}日】日记"


def body_html(text: str) -> str:
    paragraphs = [
        f"<p>{html.escape(paragraph.strip()).replace(chr(10), '<br>')}</p>"
        for paragraph in text.replace("\r\n", "\n").split("\n\n")
        if paragraph.strip()
    ]
    return "".join(paragraphs)


def write_thumbnail(source: Path, destination: Path) -> None:
    with Image.open(source) as image:
        image = ImageOps.exif_transpose(image).convert("RGB")
        image.thumbnail((720, 720), Image.Resampling.LANCZOS)
        image.save(destination, format="JPEG", quality=84, optimize=True)


def image_alt(post: dict, relative_path: str, index: int) -> str:
    for block in post.get("blocks", []):
        if block.get("type") == "image" and block.get("path") == relative_path:
            return str(block.get("alt") or f"日记图片 {index}")
    return f"日记图片 {index}"


def build_entries(root: Path, package_dir: Path) -> list[dict]:
    posts = json.loads((package_dir / "posts.json").read_text(encoding="utf-8"))
    if len(posts) != 8:
        raise ValueError(f"Expected 8 diary posts, found {len(posts)}")

    posts_dir = root / "assets" / "posts"
    thumbs_dir = root / "assets" / "thumbs"
    posts_dir.mkdir(parents=True, exist_ok=True)
    thumbs_dir.mkdir(parents=True, exist_ok=True)
    entries = []

    for post in posts:
        date = str(post["date"])
        text = str(post["body"]).strip()
        title = dated_title(date)
        if not text:
            raise ValueError(f"Diary has no body: {date}")
        if "阿明" in f"{title}\n{text}":
            continue

        images = []
        for index, relative_path in enumerate(post.get("images", []), start=1):
            source = package_dir / relative_path
            if not source.is_file():
                raise FileNotFoundError(f"Diary image not found: {source}")
            basename = f"diary-{date}-{index:02d}"
            full_path = posts_dir / f"{basename}.png"
            thumb_path = thumbs_dir / f"{basename}-thumb.jpg"
            shutil.copyfile(source, full_path)
            write_thumbnail(source, thumb_path)
            images.append({
                "src": full_path.relative_to(root).as_posix(),
                "thumb": thumb_path.relative_to(root).as_posix(),
                "alt": image_alt(post, str(relative_path), index),
            })

        if not images:
            raise ValueError(f"Diary has no images: {date}")

        entries.append({
            "id": f"diary-{date}",
            "date": date,
            "title": title,
            "body": body_html(text),
            "text": text,
            "images": images,
            "tags": ["日记", "日常", "修行"],
            "source": "",
            "notion": "",
            "favorite": False,
            "deletedAt": None,
        })

    entries.sort(key=lambda entry: entry["date"], reverse=True)
    return entries


def main() -> None:
    args = parse_args()
    root = args.root.resolve()
    entries = build_entries(root, args.package_dir.resolve())
    output = root / "diaries-2022-04-05.js"
    output.write_text(
        "window.BLOG_DIARIES_2022 = "
        + json.dumps(entries, ensure_ascii=False, indent=2)
        + ";\n",
        encoding="utf-8",
        newline="\n",
    )
    print(
        f"Generated {len(entries)} diary entries with "
        f"{sum(len(entry['images']) for entry in entries)} images."
    )


if __name__ == "__main__":
    main()
