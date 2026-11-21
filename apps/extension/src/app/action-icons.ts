import {
	ArrowUpRight,
	Copy,
	ExternalLink,
	FileDown,
	FileText,
	FolderInput,
	FolderLock,
	History,
	Pencil,
	Trash2,
	VenetianMask,
} from 'lucide-react';

/**
One icon per link action, so bookmarks, session links, and the side panel agree.
*/
export const ACTION_ICONS = {
	openHere: ArrowUpRight,
	openNew: ExternalLink,
	openPrivate: VenetianMask,
	copy: Copy,
	archiveCopy: History,
	pageCopy: FileText,
	keepCopy: FileDown,
	edit: Pencil,
	remove: Trash2,
	move: FolderInput,
	sendPrivate: FolderLock,
} as const;
