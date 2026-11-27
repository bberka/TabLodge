import {
	createContext,
	useCallback,
	use,
	useEffect,
	useRef,
	useState,
	type ReactNode,
} from 'react';
import {createPortal} from 'react-dom';
import type {LinkPreviewData} from '../shared/types';
import {send} from './message-client';

const SHOW_AFTER_MS = 600;
const CARD_WIDTH = 288;
const MARGIN = 8;

const PreviewsContext = createContext(false);

export function LinkPreviewProvider({
	enabled,
	children,
}: {
	enabled: boolean;
	children: ReactNode;
}) {
	return <PreviewsContext value={enabled}>{children}</PreviewsContext>;
}

export const useLinkPreviewsOn = () => use(PreviewsContext);

type Shown = {rect: DOMRect; preview: LinkPreviewData};

export function LinkPreview({
	url,
	children,
}: {
	url: string;
	children: ReactNode;
}) {
	const enabled = useLinkPreviewsOn();
	const [shown, setShown] = useState<Shown>();
	const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
	const wantedRef = useRef(0);

	const hide = useCallback(() => {
		clearTimeout(timerRef.current);
		wantedRef.current += 1;
		setShown(undefined);
	}, []);

	useEffect(() => hide, [hide]);
	useEffect(() => {
		if (!shown) {
			return;
		}

		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				hide();
			}
		};

		addEventListener('keydown', onKey);
		addEventListener('scroll', hide, true);
		return () => {
			removeEventListener('keydown', onKey);
			removeEventListener('scroll', hide, true);
		};
	}, [shown, hide]);

	if (!enabled) {
		return <>{children}</>;
	}

	const start = (target: HTMLElement) => {
		clearTimeout(timerRef.current);
		const ticket = ++wantedRef.current;
		timerRef.current = setTimeout(() => {
			const rect = target.getBoundingClientRect();
			void send('GET_LINK_PREVIEW', {url}).then((answer) => {
				if (
					ticket === wantedRef.current &&
					answer.ok &&
					answer.preview &&
					(answer.preview.title ||
						answer.preview.description ||
						answer.preview.image)
				) {
					setShown({rect, preview: answer.preview});
				}
			});
		}, SHOW_AFTER_MS);
	};

	return (
		<span
			className="contents"
			onPointerEnter={(event) => {
				if (event.pointerType === 'mouse') {
					start(event.currentTarget.firstElementChild as HTMLElement);
				}
			}}
			onPointerLeave={hide}
			onPointerDown={hide}
			onFocus={(event) => {
				start(event.target);
			}}
			onBlur={hide}
		>
			{children}
			{shown &&
				createPortal(<PreviewCard shown={shown} url={url} />, document.body)}
		</span>
	);
}

function PreviewCard({shown, url}: {shown: Shown; url: string}) {
	const {rect, preview} = shown;
	const left = Math.max(
		MARGIN,
		Math.min(rect.left, innerWidth - CARD_WIDTH - MARGIN),
	);
	const below = rect.bottom + MARGIN + 220 < innerHeight;
	let host = url;
	try {
		host = new URL(url).hostname.replace(/^www\./, '');
	} catch {}

	return (
		<div
			role="tooltip"
			style={{
				position: 'fixed',
				left,
				width: CARD_WIDTH,
				...(below
					? {top: rect.bottom + MARGIN}
					: {bottom: innerHeight - rect.top + MARGIN}),
			}}
			className="pointer-events-none z-50 overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-lg"
		>
			{preview.image && (
				<img
					src={preview.image}
					alt=""
					className="h-32 w-full bg-muted object-cover"
				/>
			)}
			<div className="space-y-1 p-3">
				{preview.title && (
					<p className="line-clamp-2 text-sm font-semibold leading-[1.4286]">
						{preview.title}
					</p>
				)}
				{preview.description && (
					<p className="line-clamp-3 text-xs leading-[1.3333] text-muted-foreground">
						{preview.description}
					</p>
				)}
				<p className="truncate text-[0.6875rem] text-muted-foreground">
					{host}
				</p>
			</div>
		</div>
	);
}
