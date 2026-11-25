import {extractPageCopy} from '../src/shared/page-extract';
import {CAPTURE_GLOBAL} from '../src/shared/page-copy';

(globalThis as Record<string, unknown>)[CAPTURE_GLOBAL] = extractPageCopy(
	document.cloneNode(true) as Document,
	location.href,
);
