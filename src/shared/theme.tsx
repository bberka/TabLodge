import {
	createContext,
	use,
	useCallback,
	useEffect,
	useMemo,
	useState,
	type ReactNode,
} from 'react';
import {installFocusRescue} from './focus-rescue';

export type Theme = 'system' | 'light' | 'dark';

type ThemeContextValue = {
	theme: Theme;
	setTheme: (theme: string) => Promise<void>;
	systemDark: boolean;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);
const THEMES = new Set<unknown>(['system', 'light', 'dark']);
const isTheme = (value: unknown): value is Theme => THEMES.has(value);
const THEME_KEY = 'uiTheme';

function applyDocumentTheme(theme: Theme, systemDark: boolean) {
	document.documentElement.dataset.theme = theme;
	document.documentElement.style.colorScheme =
		theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;
}

// Mirrors the stored theme into localStorage so pages with a pre-paint boot script
// (extension/theme-boot.ts) can apply it before React loads.
const MIRROR_KEY = 'tablodge.uiTheme';
function rememberTheme(theme: Theme) {
	try {
		localStorage.setItem(MIRROR_KEY, theme);
	} catch {
		/*
		Optional.
		*/
	}
}

export function ThemeProvider({children}: {children?: ReactNode}) {
	// Start from the theme a boot script may already have applied, so the first render does not reset it.
	const [theme, setTheme] = useState<Theme>(() => {
		const current = document.documentElement.dataset.theme;
		return isTheme(current) ? current : 'system';
	});
	const [systemDark, setSystemDark] = useState(
		() =>
			globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false,
	);

	useEffect(() => {
		const media = globalThis.matchMedia?.('(prefers-color-scheme: dark)');
		const onMedia = (event: MediaQueryListEvent) =>
			setSystemDark(event.matches);
		media?.addEventListener?.('change', onMedia);
		const onStorage = (
			changes: Record<string, chrome.storage.StorageChange>,
			area: chrome.storage.AreaName,
		) => {
			if (area !== 'local' || !Object.hasOwn(changes, THEME_KEY)) {
				return;
			}

			const stored: unknown = changes[THEME_KEY].newValue;
			const next = isTheme(stored) ? stored : 'system';
			setTheme(next);
			rememberTheme(next);
		};

		chrome.storage.local
			.get(THEME_KEY)
			.then((stored) => {
				const value: unknown = stored?.[THEME_KEY];
				const next = isTheme(value) ? value : 'system';
				setTheme(next);
				rememberTheme(next);
			})
			.catch(() => {});
		chrome.storage.onChanged.addListener(onStorage);
		return () => {
			media?.removeEventListener?.('change', onMedia);
			chrome.storage.onChanged.removeListener(onStorage);
		};
	}, []);

	useEffect(() => applyDocumentTheme(theme, systemDark), [theme, systemDark]);
	// Every page mounts this provider, so it also keeps focus from falling to <body> when an item is removed.
	useEffect(() => installFocusRescue(), []);

	const changeTheme = useCallback(
		async (nextValue: string) => {
			const next = isTheme(nextValue) ? nextValue : 'system';
			const previous = theme;
			setTheme(next);
			try {
				await chrome.storage.local.set({[THEME_KEY]: next});
			} catch (error) {
				setTheme(previous);
				throw error;
			}
		},
		[theme],
	);
	const value = useMemo<ThemeContextValue>(
		() => ({theme, setTheme: changeTheme, systemDark}),
		[theme, changeTheme, systemDark],
	);
	return <ThemeContext value={value}>{children}</ThemeContext>;
}

export function useTheme() {
	const value = use(ThemeContext);
	if (!value) {
		throw new Error('useTheme must be used inside ThemeProvider');
	}

	return value;
}
