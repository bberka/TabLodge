import {useEffect, useState, type ReactNode} from 'react';
import {PRIVATE_CONFIG_KEY} from './private-config';
import {send} from './message-client';
import type {PrivateStorageMode} from './types';

const PRIVATE_WINDOW_MODE_SUMMARY: Record<PrivateStorageMode, string> = {
	shared: 'Same library as regular windows',
	saved: 'Separate library saved on this device',
	temporary: 'Separate library clears on browser restart',
};

type ModeState =
	| {status: 'loading'}
	| {status: 'unavailable'}
	| {status: 'ready'; mode: PrivateStorageMode};

function PrivateWindowMark({className}: {className: string}) {
	return (
		<svg
			aria-hidden="true"
			className={className}
			viewBox="0 0 64 64"
			fill="none"
		>
			<path
				d="M12 24c.7-6.2 4.5-10.7 10.6-12.8l3-4.7h12.8l3 4.7C47.5 13.3 51.3 17.8 52 24H12Z"
				fill="currentColor"
			/>
			<path
				d="M5.5 27h53c.8 0 1.3.8.9 1.5-2.2 4.3-9.2 6.4-27.4 6.4S6.8 32.8 4.6 28.5c-.4-.7.1-1.5.9-1.5Z"
				fill="currentColor"
			/>
			<path
				d="M8 40h5m38 0h5M28.5 40h7M13 39.5h15l-1.4 7a6.4 6.4 0 0 1-12.5 0l-1.1-7Zm23 0h15l-1.1 7a6.4 6.4 0 0 1-12.5 0l-1.4-7Z"
				stroke="currentColor"
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth="3"
			/>
		</svg>
	);
}

export function PrivateWindowAppearance({children}: {children: ReactNode}) {
	return chrome.extension.inIncognitoContext ? (
		<PrivateWindowFrame>{children}</PrivateWindowFrame>
	) : (
		children
	);
}

function PrivateWindowFrame({children}: {children: ReactNode}) {
	const [modeState, setModeState] = useState<ModeState>({status: 'loading'});
	useEffect(() => {
		let mounted = true;
		const load = () => {
			void send('GET_PRIVATE_CONFIG').then((result) => {
				if (!mounted) {
					return;
				}

				setModeState(
					result.ok
						? {status: 'ready', mode: result.mode}
						: {status: 'unavailable'},
				);
			});
		};

		const changed = (
			changes: Record<string, chrome.storage.StorageChange>,
			area: chrome.storage.AreaName,
		) => {
			if (area === 'local' && Object.hasOwn(changes, PRIVATE_CONFIG_KEY)) {
				load();
			}
		};

		load();
		chrome.storage.onChanged.addListener(changed);
		return () => {
			mounted = false;
			chrome.storage.onChanged.removeListener(changed);
		};
	}, []);

	return (
		<div
			data-private-window-appearance
			className="relative isolate min-h-screen bg-background text-foreground"
		>
			<div
				aria-hidden="true"
				className="pointer-events-none fixed inset-0 z-0 grid grid-cols-4 grid-rows-12 text-muted-foreground/15 sm:grid-cols-6 sm:grid-rows-8 lg:grid-cols-8 lg:grid-rows-6"
			>
				{Array.from({length: 48}, (_, index) => (
					<div key={index} className="grid place-items-center">
						<PrivateWindowMark className="h-12 w-12 sm:h-14 sm:w-14 lg:h-16 lg:w-16" />
					</div>
				))}
			</div>
			<div className="relative z-10">
				<aside
					aria-label="Private window"
					className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border bg-muted px-5 py-3 text-sm sm:px-8"
				>
					<div className="flex min-w-0 items-center gap-3">
						<span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
							<PrivateWindowMark className="h-5 w-5" />
						</span>
						<div className="min-w-0">
							<p className="font-semibold">You’re in a private window</p>
							<p aria-live="polite" className="text-sm text-muted-foreground">
								{modeState.status === 'ready'
									? PRIVATE_WINDOW_MODE_SUMMARY[modeState.mode]
									: modeState.status === 'unavailable'
										? 'Storage mode unavailable'
										: 'Checking storage mode…'}
							</p>
						</div>
					</div>
					<a
						data-private-settings
						href="options.html#settings-private-windows"
						className="rounded-sm underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					>
						Private window settings
					</a>
				</aside>
				{children}
			</div>
		</div>
	);
}
