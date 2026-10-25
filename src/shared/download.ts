/**
Starts a download of a generated file.
*/
export function downloadFile(
	content: BlobPart,
	mime: string,
	filename: string,
) {
	const url = URL.createObjectURL(new Blob([content], {type: mime}));
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = filename;
	document.body.append(anchor);
	anchor.click();
	anchor.remove();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}
