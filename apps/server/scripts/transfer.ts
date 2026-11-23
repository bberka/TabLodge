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
