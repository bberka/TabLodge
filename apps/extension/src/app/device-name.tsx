import {useEffect, useId, useState} from 'react';
import {
	cleanDeviceName,
	defaultBrowserDeviceName,
	DEVICE_KEY,
	MAX_DEVICE_NAME,
} from '../shared/device';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';

/**
What the browser calls itself: its user agent brands, plus Brave, which only says so through its own API.
*/
async function browserBrands(): Promise<string[]> {
	const {userAgentData, brave} = navigator as Navigator & {
		userAgentData?: {brands?: Array<{brand: string}>};
		brave?: {isBrave?: () => Promise<boolean>};
	};
	const brands = (userAgentData?.brands ?? []).map(({brand}) => brand);
	if (await brave?.isBrave?.().catch(() => false)) {
		brands.push('Brave');
	}

	return brands;
}

/**
The name this browser puts on the sessions it saves, so a session list shared between devices says where each one
came from. It stays on this browser, starts filled in with the browser and system, and clearing the field goes back to that.
*/
export function DeviceNameField() {
	const id = useId();
	const helpId = `${id}-help`;
	const [fallback, setFallback] = useState('');
	const [saved, setSaved] = useState('');
	const [draft, setDraft] = useState('');

	useEffect(() => {
		void (async () => {
			const stored = (await chrome.storage.local.get([DEVICE_KEY]))[
				DEVICE_KEY
			] as {name?: unknown} | undefined;
			const name = cleanDeviceName(stored?.name);
			const brands = await browserBrands();
			let detected: string;
			try {
				const {os} = await chrome.runtime.getPlatformInfo();
				detected = defaultBrowserDeviceName(navigator.userAgent, os, brands);
			} catch {
				detected = defaultBrowserDeviceName(navigator.userAgent, '', brands);
			}

			setFallback(detected);
			setSaved(name);
			setDraft(name || detected);
		})();
	}, []);

	const commit = () => {
		const typed = cleanDeviceName(draft);
		// The detected name is not stored, so it keeps following the browser; only a different name is saved.
		const name = typed === fallback ? '' : typed;
		setDraft(name || fallback);
		if (name === saved) {
			return;
		}

		setSaved(name);
		void (name
			? chrome.storage.local.set({[DEVICE_KEY]: {name}})
			: chrome.storage.local.remove(DEVICE_KEY));
	};

	return (
		<div className="flex flex-col gap-1.5">
			<Label htmlFor={id}>Device name</Label>
			<Input
				id={id}
				value={draft}
				maxLength={MAX_DEVICE_NAME}
				placeholder={fallback}
				aria-describedby={helpId}
				onChange={(event) => {
					setDraft(event.target.value);
				}}
				onBlur={commit}
				onKeyDown={(event) => {
					if (event.key === 'Enter') {
						commit();
					}
				}}
			/>
			<p id={helpId} className="text-xs leading-5 text-muted-foreground">
				Sessions you save here say they came from this device, for example
				“Berkay’s MacBook”. It starts as the browser and system, is kept on this
				browser only, and clearing it goes back to “{fallback}”. Sessions
				already saved keep the name they had.
			</p>
		</div>
	);
}
