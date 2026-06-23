import { act, render } from '@testing-library/react';

import RowEditor from '../../../src/components/RowEditor';
import EditorBody from '../../../src/components/EditorBody';
import usePostLock from '../../../src/hooks/usePostLock';

jest.mock( '@wordpress/components', () => ( {
	SlotFillProvider: ( { children } ) => <>{ children }</>,
} ) );

jest.mock( '@wordpress/data', () => ( {
	useDispatch: () => ( { resetPost: jest.fn() } ),
} ) );

jest.mock( '@wordpress/editor', () => ( {
	EditorProvider: ( { children } ) => <>{ children }</>,
	store: {},
} ) );

jest.mock( '../../../src/components/DocumentPropertiesContext', () => ( {
	DocumentPropertiesProvider: ( { children } ) => <>{ children }</>,
} ) );

jest.mock( '../../../src/components/EditorSurfaceContext', () => ( {
	EditorSurfaceProvider: ( { children } ) => <>{ children }</>,
} ) );

jest.mock( '../../../src/components/EditorBody', () =>
	jest.fn( () => <div data-testid="editor-body" /> )
);

jest.mock( '../../../src/components/CortextLinkSuggestions', () =>
	jest.fn( () => null )
);

jest.mock( '../../../src/components/mention', () => ( {
	CortextMentions: jest.fn( () => null ),
} ) );

jest.mock( '../../../src/components/initEditor', () => ( {
	getEditorSettings: () => ( {} ),
} ) );

jest.mock( '../../../src/hooks/useAutosave', () =>
	jest.fn( () => ( {
		discard: jest.fn(),
		flushNow: jest.fn(),
		isDirty: false,
		isSaving: false,
		lastSavedAt: null,
		status: 'idle',
	} ) )
);

jest.mock( '../../../src/hooks/usePostLock', () =>
	jest.fn( () => ( {
		error: null,
		isAcquiring: false,
		isLocked: false,
		isReadOnly: false,
		isTakeover: false,
		isTakingOver: false,
		retry: jest.fn(),
		takeOver: jest.fn(),
		user: null,
	} ) )
);

const unlockedPostLock = {
	error: null,
	isAcquiring: false,
	isFailed: false,
	isLocked: false,
	isReadOnly: false,
	isTakeover: false,
	isTakingOver: false,
	retry: jest.fn(),
	takeOver: jest.fn(),
	user: null,
};

function renderRowEditor( overrides = {} ) {
	return render(
		<RowEditor
			collectionId={ 10 }
			detailKey="crtxt_tasks:20"
			fields={ [] }
			isActive
			isHidden={ false }
			onApi={ jest.fn() }
			onPaneReady={ jest.fn() }
			onRestored={ jest.fn() }
			onSaved={ jest.fn() }
			onTogglePropertiesVisible={ jest.fn() }
			post={ { id: 20, type: 'crtxt_tasks' } }
			postType="crtxt_tasks"
			propertiesVisible
			row={ { id: 20 } }
			rowId={ 20 }
			shouldAcquirePostLock
			{ ...overrides }
		/>
	);
}

describe( 'RowEditor', () => {
	beforeEach( () => {
		EditorBody.mockClear();
		usePostLock.mockReturnValue( unlockedPostLock );
		window.cortextEditorSettings = {};
	} );

	it( 'marks the pane ready after the editor body has painted', () => {
		const onPaneReady = jest.fn();

		renderRowEditor( { onPaneReady } );

		expect( onPaneReady ).not.toHaveBeenCalled();

		act( () => {
			EditorBody.mock.calls[ 0 ][ 0 ].onReady();
		} );

		expect( onPaneReady ).toHaveBeenCalledWith( 'crtxt_tasks:20' );
	} );

	it( 'keeps the pane hidden while the first post-lock check runs', () => {
		const onPaneReady = jest.fn();
		usePostLock.mockReturnValue( {
			...unlockedPostLock,
			isAcquiring: true,
			isReadOnly: true,
		} );

		const { rerender } = renderRowEditor( { onPaneReady } );

		act( () => {
			EditorBody.mock.calls[ 0 ][ 0 ].onReady();
		} );

		expect( onPaneReady ).not.toHaveBeenCalled();

		usePostLock.mockReturnValue( unlockedPostLock );
		rerender(
			<RowEditor
				collectionId={ 10 }
				detailKey="crtxt_tasks:20"
				fields={ [] }
				isActive
				isHidden={ false }
				onApi={ jest.fn() }
				onPaneReady={ onPaneReady }
				onRestored={ jest.fn() }
				onSaved={ jest.fn() }
				onTogglePropertiesVisible={ jest.fn() }
				post={ { id: 20, type: 'crtxt_tasks' } }
				postType="crtxt_tasks"
				propertiesVisible
				row={ { id: 20 } }
				rowId={ 20 }
				shouldAcquirePostLock
			/>
		);

		expect( onPaneReady ).toHaveBeenCalledWith( 'crtxt_tasks:20' );
	} );
} );
