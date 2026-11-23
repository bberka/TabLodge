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
