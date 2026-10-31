# Delivr.ai pixel: Google Tag Manager template

A Google Tag Manager tag template that loads the [Delivr.ai](https://delivr.ai) pixel, so you can install it without a Custom HTML tag.

## Install

1. In Google Tag Manager, open **Templates > Tag Templates > Search Gallery** and add **Delivr.ai Pixel**. Until it is listed, download `template.tpl` from this repository and use **New > Import**.
2. Create a tag from the template and enter your **Pixel ID**: the UUID in your install snippet, `https://cdn.delivr.ai/pixels/PIXEL_ID/p.js`.
3. Trigger it on **Initialization - All Pages** (or All Pages) and publish.

Confirm the install in the Delivr.ai dashboard: the pixel page shows the first events within a minute of a page view.

## Consent

With **Wait for Google Consent Mode consent** checked (the default), the tag:

- loads the pixel only when the selected consent type (`ad_storage` by default) is granted;
- waits and loads it as soon as consent is granted later in the page view;
- stops the pixel sending if consent is withdrawn, including a withdrawal that lands while the script is still loading, and resumes it on a later grant.

The decision applies to every Delivr.ai pixel on the page: the template mirrors Consent Mode into the page-wide `window.__delivrPixelConsent` flag, which the pixel reads before every send. If tags on the same page wait for different consent types, the pixel sends only while every one of them is granted.

A site that never sets Consent Mode reads as granted, so the pixel loads as it would from a Custom HTML tag. Your consent platform must publish its decisions to Consent Mode for this to take effect.

Separately from the template, the Delivr.ai collection endpoint attaches no identity to events from browsers that send Global Privacy Control (`Sec-GPC: 1`).

## Limits

- The template loads the pixel only from `cdn.delivr.ai`. A pixel served from a white-label domain needs a Custom HTML tag or a copy of this template with that domain added to its permissions.
- One tag per pixel. Firing the tag again on the same page does not load a second copy.

## Development

```bash
npm ci
npm test
```

`npm test` validates the template structure and permissions, then runs the `___TESTS___` scenarios from `template.tpl` against a local stand-in for the GTM sandbox (`test/gtm-runtime.mjs`). The same scenarios run in the GTM template editor's Tests tab. Every sandboxed API call is checked against the declared permissions first, so a change that needs a new permission fails here.

Report security issues as described in [SECURITY.md](SECURITY.md).
