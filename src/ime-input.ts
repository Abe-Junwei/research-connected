/** IME Enter handling for the Obsidian renderer.
 * Guide: ime-safe-enter-submit.
 * Chromium sets `isComposing` on the keydown that confirms a candidate. Some
 * IMEs then deliver that same Enter just after `compositionend`, with
 * `isComposing` already false. The timestamp window catches that ordering.
 * `keyCode` 229 is the guide's other check; this repo rejects that deprecated
 * property, so the guide's timestamp alternative is used instead.
 */

export const IME_CONFIRM_WINDOW_MS = 50;

/** True when this Enter is confirming an IME candidate, not submitting the field. */
export function isImeConfirmingEnter(
	event: Pick<KeyboardEvent, "key" | "isComposing" | "timeStamp">,
	lastCompositionEndAt: number | null,
): boolean {
	if (event.key !== "Enter") return false;
	if (event.isComposing) return true;
	return lastCompositionEndAt !== null && Math.abs(event.timeStamp - lastCompositionEndAt) < IME_CONFIRM_WINDOW_MS;
}

/** True when a form `submit` was triggered by the key that just confirmed an IME candidate. */
export function isImeSubmit(event: Pick<Event, "timeStamp">, composing: boolean, lastCompositionEndAt: number | null): boolean {
	if (composing) return true;
	return lastCompositionEndAt !== null && Math.abs(event.timeStamp - lastCompositionEndAt) < IME_CONFIRM_WINDOW_MS;
}

export function watchImeComposition(field: HTMLElement): { composing: () => boolean; lastEndAt: () => number | null } {
	let composing = false;
	let lastEndAt: number | null = null;
	field.addEventListener("compositionstart", () => {
		composing = true;
	});
	field.addEventListener("compositionend", (event) => {
		composing = false;
		lastEndAt = event.timeStamp;
	});
	return {
		composing: () => composing,
		lastEndAt: () => lastEndAt,
	};
}

/** Block implicit submission for the IME-confirming Enter. Real submits still reach bubble listeners. */
export function preventImeSubmit(form: HTMLFormElement, field: HTMLElement): void {
	const ime = watchImeComposition(field);
	form.addEventListener("submit", (event) => {
		if (!isImeSubmit(event, ime.composing(), ime.lastEndAt())) return;
		event.preventDefault();
		event.stopPropagation();
	}, true);
}
