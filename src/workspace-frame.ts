import { tr } from "./i18n";
import { surfaceBand } from "./responsive";

export interface WorkspaceFrame {
	collapsed(): { rightCollapsed: boolean };
	setCollapsed(right: boolean | undefined): void;
	toggleRight(): void;
	revealRight(): void;
	dismissTemporary(): boolean;
	apply(): void;
}

export function mountWorkspaceFrame(
	root: HTMLElement,
	body: HTMLElement,
	options: {
		embed: boolean;
		sidebar: HTMLElement;
		rightToggle: HTMLButtonElement;
		onLayout: () => void;
		onCommit: () => void;
	},
): WorkspaceFrame {
	let rightOpen = false;

	const apply = (): void => {
		body.classList.toggle("is-sidebar-collapsed", !rightOpen);
		for (const child of Array.from(options.sidebar.children)) {
			if (child !== options.rightToggle) (child as HTMLElement).inert = !rightOpen;
		}
		options.rightToggle.setAttribute("aria-expanded", String(rightOpen));
		options.rightToggle.setAttribute("aria-label", rightOpen
			? tr("折叠右侧栏", "Collapse right sidebar")
			: tr("展开右侧栏", "Expand right sidebar"));
	};

	const publish = (): void => {
		apply();
		options.onLayout();
		options.onCommit();
	};

	const frame: WorkspaceFrame = {
		collapsed: () => ({ rightCollapsed: !rightOpen }),
		setCollapsed(right) {
			if (right !== undefined) rightOpen = !right;
			apply();
			options.onLayout();
		},
		toggleRight() {
			rightOpen = !rightOpen;
			publish();
			if (!rightOpen) options.rightToggle.focus();
		},
		revealRight() {
			if (rightOpen) return;
			rightOpen = true;
			publish();
		},
		dismissTemporary() {
			if (!rightOpen || surfaceBand(root.clientWidth, options.embed) === "wide") return false;
			frame.toggleRight();
			return true;
		},
		apply,
	};

	options.rightToggle.addEventListener("click", () => frame.toggleRight());
	apply();
	return frame;
}
