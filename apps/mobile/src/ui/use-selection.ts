import {useState} from 'react';

/**
Multi-select state for a list: whether selecting is on, and which ids are picked.
*/
export function useSelection() {
	const [state, setState] = useState<{
		active: boolean;
		ids: ReadonlySet<string>;
	}>(() => ({active: false, ids: new Set()}));

	return {
		active: state.active,
		ids: state.ids,
		start(id?: string) {
			setState({active: true, ids: new Set(id ? [id] : [])});
		},
		stop() {
			setState({active: false, ids: new Set()});
		},
		toggle(id: string) {
			setState((current) => {
				const ids = new Set(current.ids);
				if (!ids.delete(id)) {
					ids.add(id);
				}

				return {...current, ids};
			});
		},
		setAll(ids: Iterable<string>) {
			setState((current) => ({...current, ids: new Set(ids)}));
		},
	};
}

export type Selection = ReturnType<typeof useSelection>;
