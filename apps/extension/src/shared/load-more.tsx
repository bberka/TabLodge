import {useCallback, useEffect, useRef, useState} from 'react';
import {Button} from '../components/ui/button';

export function LoadMore({
	remaining,
	step,
	noun,
	autoLoad = true,
	compact = false,
	onMore,
}: {
	remaining: number;
	step: number;
	noun: string;
	autoLoad?: boolean;
	compact?: boolean;
	onMore: () => void;
}) {
	const ref = useRef<HTMLButtonElement>(null);
	const onMoreRef = useRef(onMore);
	onMoreRef.current = onMore;
	useEffect(() => {
		if (!autoLoad) {
			return undefined;
		}

		const element = ref.current;
		if (!element || typeof IntersectionObserver === 'undefined') {
			return undefined;
		}

		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) {
					onMoreRef.current();
				}
			},
			{rootMargin: '800px 0px'},
		);
		observer.observe(element);
		return () => observer.disconnect();
	}, [autoLoad, remaining]);
	const amount = Math.min(step, remaining);
	const label = compact
		? `Show ${amount} more`
		: `Show ${amount} more ${noun} (${remaining} not shown yet)`;
	return (
		<Button
			ref={ref}
			variant="ghost"
			size="sm"
			className={
				compact
					? 'mt-2 flex w-full text-muted-foreground'
					: 'mx-auto mt-2 flex text-muted-foreground'
			}
			onClick={onMore}
		>
			{label}
		</Button>
	);
}

export function usePagedLimit(signature: string, page: number) {
	const [state, setState] = useState({signature, limit: page});
	const limit = state.signature === signature ? state.limit : page;
	const more = useCallback(
		() =>
			setState((old) => ({
				signature,
				limit: (old.signature === signature ? old.limit : page) + page,
			})),
		[signature, page],
	);
	const showUpTo = useCallback(
		(next: number) => setState({signature, limit: next}),
		[signature],
	);
	return [limit, more, showUpTo] as const;
}
