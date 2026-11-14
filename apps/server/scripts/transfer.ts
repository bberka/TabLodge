/*
Backs up a sync server's library to a file, or loads one into a server, through the sync API. Works for Docker and
Cloudflare servers alike; see docs/self-hosting.md.

	TABLODGE_SYNC_TOKEN=... node apps/server/scripts/transfer.ts export --url https://sync.example.com > tablodge-sync.jsonl
	TABLODGE_SYNC_TOKEN=... node apps/server/scripts/transfer.ts import --url https://sync.example.com < tablodge-sync.jsonl
*/
import process from 'node:process';
import {runTransfer} from '../src/transfer.ts';

try {
	await runTransfer(process.argv.slice(2));
} catch (error) {
	process.stderr.write(
		`${error instanceof Error ? error.message : String(error)}\n`,
	);
	process.exitCode = 1;
}
