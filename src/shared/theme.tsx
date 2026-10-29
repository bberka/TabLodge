import {
	createContext,
	use,
	useCallback,
	useEffect,
	useMemo,
	useState,
	type ReactNode,
} from 'react';
import {
	ACCENT_MIRROR_KEY,
	SYSTEM_ACCENT,
	DEFAULT_ACCENT,
	applyAccent,
	systemAccentColor,
	isAccent,
	readSavedAccent,
	watchSystemAccent,
	type Rgb,
} from './accents';
import {installFocusRescue} from './focus-rescue';

export type Theme = 'system' | 'light' | 'dark';

type ThemeContextValue = {
	theme: Theme;
	setTheme: (theme: string) => Promise<void>;
	accent: string;
	// The system accent, kept current while the accent is "system".
	systemColor: Rgb | undefined;
	setAccent: (accent: string) => Promise<void>;
	systemDark: boolean;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);
const THEMES = new Set<unknown>(['system', 'light', 'dark']);
const isTheme = (value: unknown): value is Theme => THEMES.has(value);
const THEME_KEY = 'uiTheme';
const ACCENT_KEY = 'uiAccent';

function applyDocumentTheme(theme: Theme, systemDark: boolean) {
	document.documentElement.dataset.theme = theme;
	document.documentElement.style.colorScheme =
		theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;
}

// Mirrors the stored theme and accent into localStorage so pages with a pre-paint boot script
// (extension/theme-boot.ts) can apply them before React loads.
const MIRROR_KEY = 'tablodge.uiTheme';
function remember(key: string, value: string) {
	try {
		localStorage.setItem(key, value);
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
	const [accent, setAccent] = useState(readSavedAccent);
	const [systemDark, setSystemDark] = useState(
		() =>
			globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false,
	);

	useEffect(() => {
		const media = globalThis.matchMedia?.('(prefers-color-scheme: dark)');
		const onMedia = (event: MediaQueryListEvent) =>
			setSystemDark(event.matches);
		media?.addEventListener?.('change', onMedia);
		const syncTheme = (value: unknown) => {
			const next = isTheme(value) ? value : 'system';
			setTheme(next);
			remember(MIRROR_KEY, next);
		};

		const syncAccent = (value: unknown) => {
			const next = isAccent(value) ? value : DEFAULT_ACCENT;
			setAccent(next);
			remember(ACCENT_MIRROR_KEY, next);
		};

		const onStorage = (
			changes: Record<string, chrome.storage.StorageChange>,
			area: chrome.storage.AreaName,
		) => {
			if (area === 'local' && Object.hasOwn(changes, THEME_KEY)) {
				syncTheme(changes[THEME_KEY].newValue);
			}

			if (area === 'local' && Object.hasOwn(changes, ACCENT_KEY)) {
				syncAccent(changes[ACCENT_KEY].newValue);
			}
		};

		chrome.storage.local
			.get([THEME_KEY, ACCENT_KEY])
			.then((stored) => {
				syncTheme(stored?.[THEME_KEY]);
				syncAccent(stored?.[ACCENT_KEY]);
			})
			.catch(() => {});
		chrome.storage.onChanged.addListener(onStorage);
		return () => {
			media?.removeEventListener?.('change', onMedia);
			chrome.storage.onChanged.removeListener(onStorage);
		};
	}, []);

	useEffect(() => applyDocumentTheme(theme, systemDark), [theme, systemDark]);
	const [systemColor, setSystemColor] = useState(systemAccentColor);
	useEffect(() => {
		if (accent === SYSTEM_ACCENT) {
			return watchSystemAccent(setSystemColor);
		}
	}, [accent]);
	useEffect(() => applyAccent(accent), [accent, systemColor]);
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
	const changeAccent = useCallback(
		async (nextValue: string) => {
			const next = isAccent(nextValue) ? nextValue : DEFAULT_ACCENT;
			const previous = accent;
			setAccent(next);
			try {
				await chrome.storage.local.set({[ACCENT_KEY]: next});
			} catch (error) {
				setAccent(previous);
				throw error;
			}
		},
		[accent],
	);
	const value = useMemo<ThemeContextValue>(
		() => ({
			theme,
			setTheme: changeTheme,
			accent,
			systemColor,
			setAccent: changeAccent,
			systemDark,
		}),
		[theme, changeTheme, accent, systemColor, changeAccent, systemDark],
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
