# BOOTH Forum Link Helper

Prototype Chrome extension for BOOTH pages.

It reads the BOOTH item ID, searches every available page of the public NodeBB API at `forum.ripper.store`, and adds a button below the BOOTH purchase controls that opens the matching forum topic. If the ID search finds no topic, it falls back to the product title.

## Install

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Choose this folder.
5. Open or reload a `booth.pm` product page.

The forum login remains in the browser. The extension sends no password or token to any server. It only requests the forum search endpoint with the browser's existing forum session. Search results are cached for 10 minutes, and final ranked results are cached for the current page. ID, title, and keyword searches wait up to 1.5 seconds between requests.

## Current limits

- Matching uses title words and chooses the highest-scoring result.
- The button opens the forum topic. It does not extract or open direct download links.
- It does not bypass login, CAPTCHA, Cloudflare, paywalls, or creator access controls.
- The BOOTH layout can change, so the purchase-area selector may need updates.
