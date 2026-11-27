import {useCallback, useEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Download, ExternalLink, ImageOff, Trash2} from 'lucide-react';
import {Button, TooltipProvider} from '../shared/ui';
import '../../styles/extension-app.css';
import {downloadFile} from '../shared/download';
import {
	IMAGE_EXTENSIONS,
	base64ToBytes,
	imageDataUrl,
	imageFileName,
	thumbDataUrl,
	type SavedImage,
	type SavedThumb,
} from '../shared/image-store';
import {ThemeProvider} from '../shared/theme';
import {webUrl} from '../shared/web-url';
import {PrivateWindowAppearance} from './private-window-appearance';
import {bytesText} from './recovery-core';
import {deleteSavedImage, loadSavedImage} from './saved-images';
import {
	Brand,
	EmptyState,
	LoadingLine,
	PageShell,
	StatusLine,
	useStatus,
} from './common';

const savedDate = (time: number) =>
	new Intl.DateTimeFormat(undefined, {
		dateStyle: 'long',
		timeStyle: 'short',
	}).format(time);

const url = webUrl(new URLSearchParams(location.search).get('url')) ?? '';
const pageTitle = document.title;

type Shown = {image: SavedImage | null; thumb: SavedThumb | null};

function ImageViewer() {
	const [shown, setShown] = useState<Shown | undefined>();
	const [loadError, setLoadError] = useState('');
	const [status, showStatus] = useStatus();
	const showStatusRef = useRef(showStatus);
	showStatusRef.current = showStatus;

	const load = useCallback(async (isLive: () => boolean = () => true) => {
		const loaded = await loadSavedImage(url, showStatusRef.current, isLive);
		if (!loaded) {
			return;
		}

		setLoadError(loaded.error);
		setShown({image: loaded.image, thumb: loaded.thumb});
	}, []);

	useEffect(() => {
		let live = true;
		void load(() => live);
		return () => {
			live = false;
		};
	}, [load]);

	const picture = shown?.image ?? shown?.thumb ?? null;
	const name = picture ? imageFileName(picture) : '';
	useEffect(() => {
		document.title = name ? `${name} · ${pageTitle}` : pageTitle;
	}, [name]);

	const address = url && (
		<Button asChild variant="outline" size="sm">
			<a href={url} target="_blank" rel="noopener noreferrer">
				<ExternalLink aria-hidden="true" />
				Open address
			</a>
		</Button>
	);
	const original = shown?.image;

	return (
		<PageShell className="max-w-5xl">
			<header className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
				<Brand />
				<div className="flex flex-wrap gap-2">
					{address}
					{original && (
						<Button
							variant="outline"
							size="sm"
							onClick={() => {
								downloadFile(
									base64ToBytes(original.data) as Uint8Array<ArrayBuffer>,
									original.type,
									imageFileName(original),
								);
							}}
						>
							<Download aria-hidden="true" />
							Download
						</Button>
					)}
					{picture && (
						<Button
							variant="outline"
							size="sm"
							onClick={() => void deleteSavedImage(url, showStatus, load)}
						>
							<Trash2 aria-hidden="true" />
							Delete image
						</Button>
					)}
				</div>
			</header>
			{shown === undefined ? (
				<LoadingLine />
			) : picture ? (
				<article>
					<h1 className="break-all text-xl font-bold leading-tight tracking-tight">
						{name}
					</h1>
					{!original && (
						<p className="mt-2 text-sm text-muted-foreground" role="status">
							{picture.device
								? `This is the thumbnail. The full image is kept on ${picture.device}.`
								: 'This is the thumbnail. The full image is kept on another device.'}
						</p>
					)}
					<figure className="mt-4 flex justify-center rounded-md border border-border bg-muted p-2">
						<img
							src={
								original
									? imageDataUrl(original.type, original.data)
									: thumbDataUrl(picture.thumb)
							}
							alt={`Saved from ${new URL(picture.url).hostname}`}
							width={original ? picture.width : undefined}
							height={original ? picture.height : undefined}
							className="h-auto max-h-[75vh] max-w-full object-contain"
						/>
					</figure>
					<dl className="mt-4 grid gap-x-3 gap-y-1 text-sm text-muted-foreground sm:grid-cols-[auto_minmax(0,1fr)]">
						<dt>Type</dt>
						<dd>{IMAGE_EXTENSIONS[picture.type].toUpperCase()}</dd>
						<dt>Size</dt>
						<dd>
							{picture.width} × {picture.height} pixels,{' '}
							{bytesText(picture.size)}
						</dd>
						<dt>Saved</dt>
						<dd>
							<time dateTime={new Date(picture.savedAt).toISOString()}>
								{savedDate(picture.savedAt)}
							</time>
							{picture.device && ` on ${picture.device}`}
						</dd>
						<dt>Address</dt>
						<dd className="min-w-0 break-all">
							<a
								href={picture.url}
								target="_blank"
								rel="noopener noreferrer"
								className="underline underline-offset-2 hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
							>
								{picture.url}
							</a>
						</dd>
					</dl>
				</article>
			) : (
				<EmptyState icon={ImageOff} title="No image here" action={address}>
					{loadError || 'This device has no saved image for this address.'}
				</EmptyState>
			)}
			<StatusLine status={status} />
		</PageShell>
	);
}

createRoot(document.querySelector('#root')!).render(
	<ThemeProvider>
		<PrivateWindowAppearance>
			<TooltipProvider>
				<ImageViewer />
			</TooltipProvider>
		</PrivateWindowAppearance>
	</ThemeProvider>,
);
