import { Button, createSlotFill } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { chevronLeft, chevronRight } from '@wordpress/icons';
import { useCallback, useEffect, useState } from '@wordpress/element';

import './WorkspaceTopBar.scss';

import Breadcrumbs from './Breadcrumbs';

const SLOT_NAME = 'CortextTopBarActions';

const { Slot, Fill } = createSlotFill( SLOT_NAME );

function readHistoryIndex( history ) {
	return history?.location?.state?.__TSR_index ?? 0;
}

function useHistoryNavigationState( history ) {
	const [ state, setState ] = useState( () => {
		const index = readHistoryIndex( history );
		return { index, maxIndex: index };
	} );

	useEffect( () => {
		const sync = ( action ) => {
			const index = readHistoryIndex( history );
			setState( ( previous ) => {
				const maxIndex =
					action?.type === 'PUSH'
						? index
						: Math.max( previous.maxIndex, index );
				return { index, maxIndex };
			} );
		};

		sync();
		return history.subscribe( ( { action } ) => sync( action ) );
	}, [ history ] );

	return {
		canGoBack: state.index > 0,
		canGoForward: state.index < state.maxIndex,
	};
}

// Surfaces inside the canvas (currently only the page editor) project their
// document actions into the right side of the top bar via this Fill, which
// lets them stay scoped to their own React context (EditorProvider, etc.)
// while sharing chrome with the workspace shell.
export const TopBarActionsFill = Fill;

export default function WorkspaceTopBar( { history, paintedDocumentId } ) {
	const { canGoBack, canGoForward } = useHistoryNavigationState( history );

	const goBack = useCallback( () => {
		history.flush?.();
		history.back();
	}, [ history ] );

	const goForward = useCallback( () => {
		history.flush?.();
		history.forward();
	}, [ history ] );

	return (
		<div className="cortext-topbar">
			<div className="cortext-topbar__lead">
				<div className="cortext-topbar__history-nav">
					<Button
						className="cortext-topbar__history-button"
						icon={ chevronLeft }
						label={ __( 'Go back', 'cortext' ) }
						disabled={ ! canGoBack }
						onClick={ goBack }
					/>
					<Button
						className="cortext-topbar__history-button"
						icon={ chevronRight }
						label={ __( 'Go forward', 'cortext' ) }
						disabled={ ! canGoForward }
						onClick={ goForward }
					/>
				</div>
				<Breadcrumbs paintedDocumentId={ paintedDocumentId } />
			</div>
			<div className="cortext-topbar__actions">
				<Slot bubblesVirtually />
			</div>
		</div>
	);
}
