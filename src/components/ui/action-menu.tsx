import type {ReactElement, ReactNode} from 'react';
import type {LucideIcon} from 'lucide-react';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from './dropdown-menu';
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuSub,
	ContextMenuSubContent,
	ContextMenuSubTrigger,
	ContextMenuTrigger,
} from './context-menu';
import {cn} from '@/lib/utils';

/**
One action-definition model rendered by both the dropdown (⋯) and the context (right-click) menu,
so the two menus always show the same items, icons, order, separators and styling.
*/
export type MenuAction =
	| {
			type?: 'item';
			id: string;
			label: string;
			icon?: LucideIcon;
			shortcut?: string;
			destructive?: boolean;
			disabled?: boolean;
			hidden?: boolean;
			onSelect: () => void;
	  }
	| {type: 'separator'}
	| {
			type: 'submenu';
			id: string;
			label: string;
			icon?: LucideIcon;
			hidden?: boolean;
			items: MenuAction[];
	  };

/**
Drops hidden entries, empty submenus and leading, trailing and repeated separators.
*/
export function cleanActions(actions: MenuAction[]): MenuAction[] {
	const out: MenuAction[] = [];
	for (const action of actions) {
		if (action.type === 'separator') {
			if (out.length > 0 && out.at(-1)?.type !== 'separator') {
				out.push(action);
			}

			continue;
		}

		if (action.hidden) {
			continue;
		}

		if (action.type === 'submenu') {
			const items = cleanActions(action.items);
			if (items.length === 0) {
				continue;
			}

			out.push({...action, items});
			continue;
		}

		out.push(action);
	}

	while (out.at(-1)?.type === 'separator') {
		out.pop();
	}

	return out;
}

const destructiveClass =
	'text-destructive focus:bg-destructive/10 focus:text-destructive';

function Shortcut({children}: {children: ReactNode}) {
	return (
		<span className="ml-auto pl-4 text-xs tracking-wide text-muted-foreground">
			{children}
		</span>
	);
}

type Kit = {
	Item: typeof DropdownMenuItem;
	Separator: typeof DropdownMenuSeparator;
	Sub: typeof DropdownMenuSub;
	SubTrigger: typeof DropdownMenuSubTrigger;
	SubContent: typeof DropdownMenuSubContent;
};

const dropdownKit: Kit = {
	Item: DropdownMenuItem,
	Separator: DropdownMenuSeparator,
	Sub: DropdownMenuSub,
	SubTrigger: DropdownMenuSubTrigger,
	SubContent: DropdownMenuSubContent,
};
// The context-menu primitives share the same prop shapes as the dropdown ones.
const contextKit = {
	Item: ContextMenuItem,
	Separator: ContextMenuSeparator,
	Sub: ContextMenuSub,
	SubTrigger: ContextMenuSubTrigger,
	SubContent: ContextMenuSubContent,
};

function renderActions(actions: MenuAction[], kit: Kit): ReactNode {
	return cleanActions(actions).map((action, index) => {
		if (action.type === 'separator') {
			return <kit.Separator key={`sep-${index}`} />;
		}

		const Icon = action.icon;
		if (action.type === 'submenu') {
			return (
				<kit.Sub key={action.id}>
					<kit.SubTrigger>
						{Icon && <Icon />}
						<span>{action.label}</span>
					</kit.SubTrigger>
					<kit.SubContent>{renderActions(action.items, kit)}</kit.SubContent>
				</kit.Sub>
			);
		}

		return (
			<kit.Item
				key={action.id}
				disabled={action.disabled}
				className={cn(action.destructive && destructiveClass)}
				onSelect={() => {
					action.onSelect();
				}}
			>
				{Icon && <Icon />}
				<span>{action.label}</span>
				{action.shortcut && <Shortcut>{action.shortcut}</Shortcut>}
			</kit.Item>
		);
	});
}

export function ActionDropdownMenu({
	actions,
	trigger,
	align = 'end',
}: {
	actions: MenuAction[];
	trigger: ReactElement;
	align?: 'start' | 'end';
}) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
			<DropdownMenuContent align={align}>
				{renderActions(actions, dropdownKit)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

export function ActionContextMenu({
	actions,
	children,
}: {
	actions: MenuAction[];
	children: ReactElement;
}) {
	return (
		<ContextMenu>
			<ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
			<ContextMenuContent>
				{renderActions(actions, contextKit)}
			</ContextMenuContent>
		</ContextMenu>
	);
}
