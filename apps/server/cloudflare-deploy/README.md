# TabLodge sync server for Cloudflare

This folder is what the **Deploy to Cloudflare** button copies into a new repository of yours. It runs the [TabLodge](https://github.com/bberka/TabLodge) sync server as a Worker with one Durable Object on your Cloudflare account. The setup guide is [Self hosting](https://github.com/bberka/TabLodge/blob/master/docs/self-hosting.md#option-b-cloudflare).

`worker.js` is built from the TabLodge source (`apps/server/src`), so do not edit it here.

## Your own domain

To serve the Worker at a hostname of yours, set `CUSTOM_DOMAIN` under `vars` in `wrangler.jsonc` and commit. Read the [requirements and effects](https://github.com/bberka/TabLodge/blob/master/docs/self-hosting.md#your-own-domain) first.

## Update

Copy the newest [`worker.js`](https://github.com/bberka/TabLodge/blob/release/apps/server/cloudflare-deploy/worker.js) from TabLodge's `release` branch over the one in your repository (on GitHub: open the file, choose **Edit**, paste, and commit). Cloudflare deploys the commit, and your library and token stay as they are.

The repository also holds the **Update TabLodge** workflow (`.github/workflows/update-tablodge.yml`), switched off. To update on each release by itself, add the repository variable `TABLODGE_AUTO_UPDATE` with the value `true` under **Settings › Secrets and variables › Actions › Variables**. [Update automatically](https://github.com/bberka/TabLodge/blob/master/docs/self-hosting.md#update-automatically) has the details, including how to add the file to a server deployed before it shipped.
