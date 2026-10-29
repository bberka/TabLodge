/**
The index a radio group moves to for a key press, or null when the key does nothing there.
Arrow keys wrap around, as in the WAI-ARIA radio group pattern; Home and End jump to the ends.
*/
export function radioTargetIndex(
	key: string,
	current: number,
	count: number,
): number | null {
	if (count <= 0) {
		return null;
	}

	switch (key) {
		case 'ArrowRight':
		case 'ArrowDown': {
			return (current + 1) % count;
		}

		case 'ArrowLeft':
		case 'ArrowUp': {
			return (current - 1 + count) % count;
		}

		case 'Home': {
			return 0;
		}

		case 'End': {
			return count - 1;
		}

		default: {
			return null;
		}
	}
}
