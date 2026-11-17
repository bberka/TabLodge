// Injected into the open tab by "Keep a copy" (chrome.scripting with activeTab, so no host permission). It reads a
// clone of the page as rendered, with the shared extractor, and leaves the copy where the worker's next call picks it
// up: an injected file cannot hand back a value of its own. It runs in the extension's isolated world, so the page's
// scripts never see the copy.
import {extractPageCopy} from '../src/shared/page-extract';
import {CAPTURE_GLOBAL} from '../src/shared/page-copy';

(globalThis as Record<string, unknown>)[CAPTURE_GLOBAL] = extractPageCopy(
	document.cloneNode(true) as Document,
	location.href,
);
