#!/usr/bin/env python3
"""Build the static blog and compile Markdown posts into its article bundle."""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import posixpath
import re
import shutil
import unicodedata
from datetime import date, datetime
from html.parser import HTMLParser
from pathlib import Path, PurePosixPath
from urllib.parse import urlsplit

import markdown
import yaml


SITE_FILES = (
    "index.html",
    "styles.css",
    "script.js",
    "favicon.svg",
    "articles.js",
    "diaries-2010.js",
    "diaries-2022-04-05.js",
    "wechat-articles.js",
    "custom-entries.js",
)
FRONT_MATTER = re.compile(r"\A---[ \t]*\r?\n(.*?)\r?\n---[ \t]*\r?\n(.*)\Z", re.DOTALL)
IMAGE_TAG = re.compile(r"<img\b[^>]*>", re.IGNORECASE)
ATTRIBUTE = re.compile(r"""(?P<name>[\w:-]+)\s*=\s*(?P<quote>["'])(?P<value>.*?)(?P=quote)""", re.DOTALL)
HTTP_SCHEMES = {"http", "https"}
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".gif", ".webp"}


class TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        value = data.strip()
        if value:
            self.parts.append(value)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--output", type=Path)
    return parser.parse_args()


def read_post(path: Path) -> tuple[dict, str]:
    source = path.read_text(encoding="utf-8-sig")
    match = FRONT_MATTER.fullmatch(source)
    if not match:
        raise ValueError(f"{path}: missing YAML front matter")
    metadata = yaml.safe_load(match.group(1)) or {}
    if not isinstance(metadata, dict):
        raise ValueError(f"{path}: front matter must be a mapping")
    return metadata, match.group(2).strip()


def post_date(value: object, path: Path) -> str:
    if isinstance(value, datetime):
        value = value.date()
    if isinstance(value, date):
        return value.isoformat()
    text = str(value or "").strip()
    try:
        return date.fromisoformat(text).isoformat()
    except ValueError as error:
        raise ValueError(f"{path}: date must use YYYY-MM-DD") from error


def post_tags(value: object, path: Path) -> list[str]:
    if value is None:
        return []
    values = value if isinstance(value, list) else str(value).split(",")
    tags: list[str] = []
    for item in values:
        tag = str(item).lstrip("#").strip()
        if tag and tag.casefold() not in {existing.casefold() for existing in tags}:
            tags.append(tag)
    if any(len(tag) > 40 for tag in tags):
        raise ValueError(f"{path}: tags must be 40 characters or fewer")
    return tags


def slugify(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value).strip().casefold()
    slug = "".join(character if character.isalnum() else "-" for character in normalized)
    slug = re.sub(r"-+", "-", slug).strip("-")
    return slug or "post"


def post_id(metadata: dict, relative_path: Path) -> str:
    requested = str(metadata.get("id") or metadata.get("slug") or "").strip()
    source = requested or relative_path.with_suffix("").as_posix()
    return f"markdown-{slugify(source)}"


def normalize_image_source(value: str, root: Path, post_path: Path) -> str:
    source = html.unescape(value).strip().replace("\\", "/")
    parsed = urlsplit(source)
    if parsed.scheme.lower() in HTTP_SCHEMES and parsed.netloc:
        return source
    if parsed.scheme or parsed.netloc or parsed.query or parsed.fragment:
        raise ValueError(f"{post_path}: unsupported image URL: {source}")

    while source.startswith("../"):
        source = source[3:]
    source = source.removeprefix("./").lstrip("/")
    normalized = posixpath.normpath(source)
    path = PurePosixPath(normalized)
    if (
        normalized == "."
        or ".." in path.parts
        or path.parts[:2] != ("assets", "posts")
        or path.suffix.lower() not in IMAGE_SUFFIXES
    ):
        raise ValueError(
            f"{post_path}: local images must be under assets/posts: {value}"
        )

    absolute = (root / Path(*path.parts)).resolve()
    posts_root = (root / "assets" / "posts").resolve()
    if posts_root not in absolute.parents or not absolute.is_file():
        raise FileNotFoundError(f"{post_path}: image not found: {normalized}")
    return normalized


def thumbnail_for(source: str, root: Path) -> str:
    if urlsplit(source).scheme:
        return source
    image_path = PurePosixPath(source)
    thumbnail = root / "assets" / "thumbs" / f"{image_path.stem}-thumb.jpg"
    return thumbnail.relative_to(root).as_posix() if thumbnail.is_file() else source


def image_attributes(tag: str) -> dict[str, str]:
    return {
        match.group("name").lower(): html.unescape(match.group("value"))
        for match in ATTRIBUTE.finditer(tag)
    }


def normalize_body_images(body: str, root: Path, post_path: Path) -> tuple[str, list[dict]]:
    images: list[dict] = []

    def replace_image(match: re.Match[str]) -> str:
        attributes = image_attributes(match.group(0))
        source = normalize_image_source(attributes.get("src", ""), root, post_path)
        alt = attributes.get("alt", "").strip() or f"文章图片 {len(images) + 1}"
        images.append(
            {
                "src": source,
                "thumb": thumbnail_for(source, root),
                "alt": alt,
                "inline": True,
            }
        )
        return (
            f'<img src="{html.escape(source, quote=True)}" '
            f'alt="{html.escape(alt, quote=True)}" loading="lazy" decoding="async">'
        )

    return IMAGE_TAG.sub(replace_image, body), images


def plain_text(body: str) -> str:
    extractor = TextExtractor()
    extractor.feed(body)
    return " ".join(extractor.parts)


def build_entry(root: Path, path: Path) -> dict:
    metadata, source = read_post(path)
    title = str(metadata.get("title") or "").strip()
    if not title:
        raise ValueError(f"{path}: title is required")
    if not source:
        raise ValueError(f"{path}: Markdown body is empty")

    body = markdown.markdown(
        source,
        extensions=["extra", "sane_lists"],
        output_format="html",
    )
    body, images = normalize_body_images(body, root, path)

    cover_value = str(metadata.get("cover") or "").strip()
    if cover_value:
        cover = normalize_image_source(cover_value, root, path)
        existing = next((image for image in images if image["src"] == cover), None)
        if existing:
            images.remove(existing)
            images.insert(0, existing)
        else:
            images.insert(
                0,
                {
                    "src": cover,
                    "thumb": thumbnail_for(cover, root),
                    "alt": f"{title} 封面",
                    "inline": False,
                },
            )

    summary = str(metadata.get("summary") or "").strip()
    source_url = str(metadata.get("source") or "").strip()
    if source_url and urlsplit(source_url).scheme.lower() not in HTTP_SCHEMES:
        raise ValueError(f"{path}: source must be an http(s) URL")

    return {
        "id": post_id(metadata, path.relative_to(root / "posts")),
        "date": post_date(metadata.get("date"), path),
        "title": title,
        "summary": summary,
        "body": body or "<p><br></p>",
        "text": plain_text(body),
        "images": images,
        "tags": post_tags(metadata.get("tags"), path),
        "source": source_url,
        "notion": "",
        "favorite": False,
        "deletedAt": None,
    }


def build_markdown_entries(root: Path) -> list[dict]:
    posts_dir = root / "posts"
    paths = (
        sorted(path for path in posts_dir.rglob("*.md") if not path.name.startswith("_"))
        if posts_dir.is_dir()
        else []
    )
    entries = [build_entry(root, path) for path in paths]
    identifiers = [entry["id"] for entry in entries]
    duplicates = sorted({identifier for identifier in identifiers if identifiers.count(identifier) > 1})
    if duplicates:
        raise ValueError(f"Duplicate Markdown post IDs: {', '.join(duplicates)}")
    return sorted(entries, key=lambda entry: (entry["date"], entry["id"]), reverse=True)


def copy_site(root: Path, output: Path, entries: list[dict]) -> None:
    if output.exists():
        shutil.rmtree(output)
    output.mkdir(parents=True)

    for relative_name in SITE_FILES:
        source = root / relative_name
        if not source.is_file():
            raise FileNotFoundError(f"Required site file not found: {source}")
        shutil.copy2(source, output / relative_name)

    assets = root / "assets"
    if not assets.is_dir():
        raise FileNotFoundError(f"Required assets directory not found: {assets}")
    shutil.copytree(assets, output / "assets")
    bundle = (
        "window.BLOG_MARKDOWN_ARTICLES = "
        + json.dumps(entries, ensure_ascii=False, indent=2)
        + ";\n"
    )
    (output / "markdown-articles.js").write_text(
        bundle,
        encoding="utf-8",
        newline="\n",
    )
    bundle_version = hashlib.sha256(bundle.encode("utf-8")).hexdigest()[:12]
    index_path = output / "index.html"
    index_path.write_text(
        index_path.read_text(encoding="utf-8").replace(
            'src="markdown-articles.js"',
            f'src="markdown-articles.js?v={bundle_version}"',
        ),
        encoding="utf-8",
        newline="\n",
    )
    (output / ".nojekyll").write_text("", encoding="utf-8")


def main() -> None:
    args = parse_args()
    root = args.root.resolve()
    output = (args.output or root / "_site").resolve()
    if output == root or root not in output.parents:
        raise ValueError("Output directory must be inside the project root")
    entries = build_markdown_entries(root)
    copy_site(root, output, entries)
    print(f"Built {output} with {len(entries)} Markdown post(s).")


if __name__ == "__main__":
    main()
