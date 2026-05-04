import { createSlotFill } from '@wordpress/components';

import Breadcrumbs from './Breadcrumbs';

const SLOT_NAME = 'CortextTopBarActions';

const { Slot, Fill } = createSlotFill( SLOT_NAME );

// Surfaces inside the canvas (currently only the page editor) project their
// document actions into the right side of the top bar via this Fill, which
// lets them stay scoped to their own React context (EditorProvider, etc.)
// while sharing chrome with the workspace shell.
export const TopBarActionsFill = Fill;

export default function WorkspaceTopBar() {
	return (
		<div className="cortext-topbar">
			<div className="cortext-topbar__lead">
				<Breadcrumbs />
			</div>
			<div className="cortext-topbar__actions">
				<Slot bubblesVirtually />
			</div>
		</div>
	);
}
