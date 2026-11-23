import {useEffect, useState} from 'react';
import {SEARCH_COUNT_DELAY} from '../library/search-count';

export function useSettledText(active: boolean, text: string) {
	const [settled, setSettled] = useState<string>();
	useEffect(() => {
		if (!active) {
			setSettled(undefined);
			return;
		}

		const timer = setTimeout(() => {
			setSettled(text);
		}, SEARCH_COUNT_DELAY);
		return () => {
			clearTimeout(timer);
		};
	}, [active, text]);
	return active ? settled : undefined;
}
