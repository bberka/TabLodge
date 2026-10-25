import {
	ArrowUpRight,
	Copy,
	ExternalLink,
	FolderInput,
	Pencil,
	Trash2,
} from 'lucide-react';

/**
One icon per link action, so bookmarks, session links, and the side panel agree.
*/
export const ACTION_ICONS = {
	openHere: ArrowUpRight,
	openNew: ExternalLink,
	copy: Copy,
	edit: Pencil,
	remove: Trash2,
	move: FolderInput,
} as const;
