import {useState} from 'react';
import type {DeleteQuestion} from '../shared/delete-question';
import {ConfirmationDialog} from '../shared/ui';

export function useDeleteConfirmation(ask: boolean) {
	const [asked, setAsked] = useState<{
		question: DeleteQuestion;
		remove: () => void;
	}>();
	const [open, setOpen] = useState(false);

	return {
		askBeforeDeleting(question: DeleteQuestion, remove: () => void) {
			if (!ask) {
				remove();
				return;
			}

			setAsked({question, remove});
			setOpen(true);
		},
		confirmationDialog: (
			<ConfirmationDialog
				open={open}
				title={asked?.question.title}
				description={asked?.question.description}
				onOpenChange={setOpen}
				onConfirm={() => {
					setOpen(false);
					asked?.remove();
				}}
			/>
		),
	};
}
