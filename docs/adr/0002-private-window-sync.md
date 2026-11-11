# 2. Private window sync

Status: accepted, 2026-11-11. Issue #3.

## Context

Private windows can use the regular library, a separate saved library, or a separate temporary one, and the saved one can be locked with a PIN or password ([Private library lock](../architecture.md#private-library-lock)). The first version of sync left all private data alone: only the regular worker runs sync, so in shared mode private window edits reached the server only on the next five minute round, and a separate library never synced. The maintainer asked for private sync as an option, encrypted whenever the private library has a PIN or password.

## Decision

* **Shared mode.** No change in what syncs; private window edits are regular library edits. The private worker writes `tablodge.sync.nudge` after each save, and the regular worker treats that as a local change, so they go out at once. Split workers cannot message each other but share local storage.
* **Where the private library goes.** A second library on the same server, under `/private`: a second Durable Object on Cloudflare and `private.db` on Docker, through the same API. It uses the regular connection, so there is nothing else to set up and disconnecting the regular sync ends it too. Keeping it apart means the regular library and older extensions never see private records. `/v1/status` lists `features`, so the extension can tell an older server to update.
* **Who runs it.** The private worker, only while a private window is open and the library is unlocked. A locked library cannot be read, and there is no other place the decrypted records could come from. Temporary storage never syncs, since it is meant to vanish with the browser.
* **Encryption.** A random 256 bit sync key per private library on the server, not one derived from the PIN directly. The server stores the key wrapped in the same PBKDF2 envelope the lock uses, behind compare and set (`/v1/key`), so two browsers cannot each install their own. Each value is sealed with AES-GCM and the record key as authenticated data, so the server cannot move a value to another record. A browser joins by entering the PIN or password once and keeps the unwrapped key in its private storage, which its own lock seals. Changing the credential rewraps the same key, so nothing is encrypted again and other browsers keep working. The record kind, id, stamp, and order key stay readable, because the server needs them to merge.
* **Becoming encrypted.** The rule is that the server's copy is encrypted once any browser protects it. A browser that sets its first PIN or password while syncing creates the key and sends every record again sealed. A browser that pulls a plain value into an encrypted library sends it again sealed. A browser without the key that finds the library encrypted stops and asks for the PIN or password.

## Consequences

* The server learns how many private records there are and when they change, not what they hold.
* A PIN is a weak secret against whoever holds the server's data, who can try every PIN offline against the wrapped key. The guide and privacy notes say so and suggest a password.
* Forgetting the PIN or password on every browser loses access to the server's copy. Each browser's own private library is unaffected.
* Private changes reach another browser only while a private window is open there.
