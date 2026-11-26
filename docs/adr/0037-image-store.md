# 37. Saved images: originals on the device, thumbnails in sync

Status: accepted, 2026-11-27. Issue #511.

## Context

**Bookmark image to** kept an image's address and nothing else. Signed image addresses expire and some hosts refuse a request that does not come from their page, so the picture could be gone while its bookmark still looked fine. The first plan for #511 downloaded the file to the Downloads folder. The maintainer chose the full store instead: the picture is kept inside TabLodge with its bookmark, with a thumbnail on the board, a viewer, and backups that include it.

Three limits shape the design. The extension holds no website access and adds none. The sync server refuses a change over 256 KB and a request over 8 MB (`apps/server/src/api.ts`). A full backup used to travel to the page in one message, which Chromium caps near 64 MB.

## Decision

* **An image belongs to an address, like a page copy ([ADR 7](0007-readable-page-copies.md)).** It lives while a link in the library or the trash has its address, so it follows its bookmark into the trash, comes back on restore, and goes when the trash is emptied. The sweep that drops unheld page copies drops unheld images.
* **The bytes are read in the tab, under `activeTab`.** The menu click grants access to that one tab, and `captureImage` (`src/app/image-capture-inject.ts`) fetches the image there and draws the thumbnail on a canvas. A same-origin image, or one served with CORS headers, is kept. An image the host will not hand to a script still gets its bookmark, and the note says the picture was not kept. An all-sites host permission would read every image, at the price of an install warning and a store review question, so it is not requested.
* **Nothing the page hands over is trusted.** `image-store.ts` works out the type from the first bytes (JPEG, PNG, GIF, WebP, AVIF) and refuses everything else, including SVG and HTML. It checks the base64, both sizes, and the dimensions again in the worker. Pages show the bytes only through `<img>`.
* **One store, two backends.** `image-store.ts` keeps an index (`tablodge.images`), the original (`tablodge.image.<hash>`), and a WebP thumbnail of at most 256 px and 10 KB (`tablodge.thumb.<hash>`) behind the three-call storage interface page copies use. The hash is `hashText` of the address, so every device names a picture the same way.
* **10 MB per image, 100 MB of originals per device,** counted apart from the 25 MB of page copies. A save that does not fit is refused by name and the bookmark is still added. Nothing is evicted to make room.
* **Sync carries the thumbnail, never the original.** Each image is one record of kind `thumb` behind the server feature `thumbs`, as notes and tags are ([ADR 5](0005-bookmark-notes-sync.md), [ADR 8](0008-bookmark-tags-sync.md)). A record is about 14 KB, far under the 256 KB change limit, and a full push of 500 stays under the 8 MB request limit. Chunking a 5 MB photo would be 27 changes every device has to pull, store, and reassemble, in a change log sized for small JSON, and would make the sync server a photo host, which #284 left open for page copies. Keeping everything on one device would leave the phone and other browsers with no sign that a picture exists. The record names the device that holds the original.
* **A device that receives a thumbnail for an image it also holds keeps its original and takes the record as sent,** so two holders never push their own versions back and forth.
* **A delete travels.** Deleting the image on any device deletes the `thumb` record, and each device that applies it drops its thumbnail and its original.
* **The full backup carries the bytes as files.** `images.json` lists the pictures with their thumbnails, and each original is a real file under `images/`, stored without compression. The page asks the worker for one original at a time, so the single-message cap does not bound them.
* **The Android app shows thumbnails and keeps no originals.** Its share sheet receives a file with no address to bookmark, and drawing a thumbnail on the phone needs a native module the app does not have.
* **No images from private windows or for the private library.** The store is not encrypted.

## Consequences

* A hotlink-protected image without CORS headers cannot be kept. The note says so, and the bookmark keeps the address.
* A device can show a thumbnail whose original is on another device. The viewer says which device.
* A backup grows by up to 100 MB.
* `PROTOCOL_VERSION` stays 1. Old clients drop the unknown `thumb` kind, and old servers never receive it.
