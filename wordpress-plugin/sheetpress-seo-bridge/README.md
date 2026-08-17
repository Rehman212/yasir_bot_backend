# SheetPress SEO Bridge

Install this small plugin on your WordPress site so SheetPress can write **Rank Math / Yoast** SEO fields.

## Install

1. Zip the folder `sheetpress-seo-bridge` (so the zip contains `sheetpress-seo-bridge.php` inside a folder).
2. WordPress admin → **Plugins → Add New → Upload Plugin**
3. Upload the zip → **Activate**

Or copy the folder to:

`wp-content/plugins/sheetpress-seo-bridge/`

## What it does

Exposes:

- `GET /wp-json/sheetpress/v1/ping`
- `POST /wp-json/sheetpress/v1/seo/{postId}`

Body JSON:

```json
{
  "seoTitle": "My SEO Title",
  "seoDescription": "My meta description",
  "focusKeyword": "main keyword"
}
```

Uses Application Password auth (same as SheetPress site connection).
