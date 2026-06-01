import { act, render } from '@testing-library/react';

import RowEditor from '../../../src/components/RowEditor';
import EditorBody from '../../../src/components/EditorBody';

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

describe( 'RowEditor', () => {
	beforeEach( () => {
		EditorBody.mockClear();
		window.cortextEditorSettings = {};
	} );

	it( 'waits for the editor body paint signal before marking the pane ready', () => {
		const onPaneReady = jest.fn();

		render(
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
			/>
		);

		expect( onPaneReady ).not.toHaveBeenCalled();

		act( () => {
			EditorBody.mock.calls[ 0 ][ 0 ].onReady();
		} );

		expect( onPaneReady ).toHaveBeenCalledWith( 'crtxt_tasks:20' );
	} );
} );
