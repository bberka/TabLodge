import type {ReactNode} from 'react';

export function PrivateWindowMark({className}: {className: string}) {
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
	if (!chrome.extension.inIncognitoContext) {
		return children;
	}

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
			<div className="relative z-10">{children}</div>
		</div>
	);
}
