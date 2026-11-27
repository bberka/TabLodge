export type WranglerConfig = Record<string, unknown> & {
	vars?: Record<string, string>;
};

export function parseJsonc(text: string): WranglerConfig;

export function normalizeDomain(raw: string): string;

export function readCustomDomain(
	configPath: string,
	env?: Readonly<Record<string, string | undefined>>,
): string;

export function prepareWranglerDeploy(options: {
	directory: string;
	domain?: string;
	extraArgs?: string[];
	env?: Readonly<Record<string, string | undefined>>;
}): {args: string[]; cleanup: () => void};

export function runDeploy(directory: string, extraArgs: string[]): number;

export function runFromCommandLine(directory: string): void;
