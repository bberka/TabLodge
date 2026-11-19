import * as Clipboard from 'expo-clipboard';
import {showSnack} from '../ui/snackbar';

export async function copyLink(url: string): Promise<void> {
	await Clipboard.setStringAsync(url);
	showSnack('Link copied');
}
