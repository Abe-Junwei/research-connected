let titleSequence = 0;

/** Name a native modal and allow backdrop dismissal.
 * Guides: dialog, light-dismiss-a-dialog, platform-controls-dismiss-dialog.
 * `closedby` is progressive enhancement: Escape already closes `showModal()` dialogs.
 * Callers treat dismissal as cancel and do not save.
 */
export function labelModalDialog(dialog: HTMLDialogElement, title: HTMLElement): void {
	if (!title.id) title.id = `cpo-dialog-title-${++titleSequence}`;
	dialog.setAttribute("aria-labelledby", title.id);
	dialog.removeAttribute("aria-label");
	dialog.setAttribute("closedby", "any");
}
