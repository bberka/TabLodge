# TabLodge sync server for Cloudflare

This folder is what the **Deploy to Cloudflare** button copies into a new repository of yours. It runs the [TabLodge](https://github.com/bberka/TabLodge) sync server as a Worker with one Durable Object on your Cloudflare account. The setup guide is [Self hosting](https://github.com/bberka/TabLodge/blob/master/docs/self-hosting.md#option-b-cloudflare).

`worker.js` is built from the TabLodge source (`apps/server/src`), so do not edit it here.

## Update

Copy the newest [`worker.js`](https://github.com/bberka/TabLodge/blob/master/apps/server/cloudflare-deploy/worker.js) from TabLodge over the one in your repository (on GitHub: open the file, choose **Edit**, paste, and commit). Cloudflare deploys the commit, and your library and token stay as they are.
