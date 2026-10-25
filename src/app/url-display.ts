/**
The address as shown in lists and summaries. With `simplify`, a leading `https://` and then `www.` are dropped,
and so is the slash of a bare `/` path (`https://www.icloud.com/mail` becomes `icloud.com/mail`, `https://github.com/` becomes `github.com`). `http://` stays visible because it marks an insecure link. Display only: stored, copied, opened, and exported addresses are never changed.
*/
export function displayUrl(url: string, simplify = true): string {
	if (!simplify || !/^https:\/\//i.test(url)) {
		return url;
	}

	const text = url
		.replace(/^https:\/\//i, '')
		.replace(/^www\./i, '')
		.replace(/^([^#/?]*)\/(?=$|[#?])/, '$1');
	return text || url;
}
