// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- the worker project has no DOM types, and these functions run in a page
/// <reference lib="dom" />

export function takeCapturedCopy(name: string): unknown {
	const scope = globalThis as Record<string, unknown>;
	const value = scope[name];
	Reflect.deleteProperty(scope, name);
	return value;
}

export function showPageNote(message: string, isError: boolean): void {
	const id = 'tablodge-page-note';
	document.querySelector(`#${id}`)?.remove();
	const host = document.createElement('div');
	host.id = id;
	const root = host.attachShadow({mode: 'closed'});
	const note = document.createElement('div');
	note.setAttribute('role', isError ? 'alert' : 'status');
	note.textContent = message;
	note.style.cssText = [
		'position:fixed',
		'z-index:2147483647',
		'right:16px',
		'bottom:16px',
		'max-width:min(420px,calc(100vw - 32px))',
		'padding:12px 16px',
		'border-radius:8px',
		'font:14px/1.4 system-ui,sans-serif',
		'box-shadow:0 4px 16px rgb(0 0 0 / 0.25)',
		`background:${isError ? '#7f1d1d' : '#1f2937'}`,
		'color:#fff',
	].join(';');
	root.append(note);
	document.documentElement.append(host);
	setTimeout(() => {
		host.remove();
	}, 6000);
}
