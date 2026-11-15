import type {BrowserContext} from 'playwright';

export function stopWatchersWhenBrowserCloses(
	context: Pick<BrowserContext, 'once'>,
	watchers: Array<{close(): Promise<void>}>,
): Promise<void> {
	return new Promise((resolve, reject) => {
		context.once('close', () => {
			void Promise.all(watchers.map((watcher) => watcher.close())).then(
				() => resolve(),
				reject,
			);
		});
	});
}
