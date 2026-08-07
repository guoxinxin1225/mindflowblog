# Mindflow Blog

“心流号空间站”是一个由 GitHub Pages 托管的静态博客。现有微博、日记和微信文章继续使用原有数据文件；新增文章放在 `posts/` 中，以 Markdown 编写并由 GitHub Actions 自动发布。

## 发布一篇 Markdown 文章

1. 在 GitHub 仓库中打开 `posts/`。
2. 参考 [`posts/_template.md`](posts/_template.md)，点击 **Add file → Create new file** 或 **Upload files**。
3. 文件名不要以下划线开头，建议使用 `YYYY-MM-DD-title.md`。
4. 提交到 `main`。等待仓库 **Actions** 页面中的 Pages 工作流完成，网页会自动更新。

每篇文章必须包含 YAML front matter：

```yaml
---
title: 文章标题
date: 2026-08-08
tags:
  - 随笔
summary: 首页卡片摘要（可选）
cover: ../assets/posts/cover.jpg
source: https://example.com/original
---
```

`title` 和 `date` 必填；`tags`、`summary`、`cover`、`source` 可选。`date` 必须使用 `YYYY-MM-DD`。

## 添加图片

1. 先把图片上传到 `assets/posts/`，文件名建议只用英文字母、数字、短横线和扩展名。
2. 在 Markdown 中引用：

```markdown
![图片说明](../assets/posts/photo-name.jpg)
```

支持 JPG、JPEG、PNG、GIF 和 WebP。构建时会检查本地图片是否存在；引用错误会让 Actions 失败并显示具体文件名。

## 本地预览

```powershell
python -m pip install -r requirements.txt
python tools/build-site.py
python -m http.server 8080 --directory _site
```

然后访问 <http://localhost:8080>。

网页中的“编辑/新建文章”功能只保存到当前浏览器，不会更新 GitHub。需要公开发布的内容请始终通过 `posts/` 中的 Markdown 文件更新。

## 部署内容

`tools/build-site.py` 只把网页运行所需的 HTML、CSS、JavaScript、文章数据和 `assets/` 复制到 `_site/`。本地 Word 文档、原始导入目录、工具脚本和 Markdown 源文件不会出现在公开站点产物中。
