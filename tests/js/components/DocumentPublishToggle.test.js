import { fireEvent, render, screen, waitFor } from '@testing-library/react';

jest.mock( '@wordpress/i18n', () => ( {
	__: ( value ) => value,
	sprintf: ( value ) => value,
} ) );

jest.mock( '@wordpress/components', () => ( {
	__esModule: true,
	__experimentalConfirmDialog: ( { children, onConfirm } ) => (
		<div role="dialog">
			{ children }
			<button type="button" onClick={ onConfirm }>
				Confirm
			</button>
		</div>
	),
} ) );

jest.mock( '@wordpress/data', () => ( {
	__esModule: true,
	useDispatch: jest.fn(),
	useRegistry: jest.fn(),
	useSelect: jest.fn(),
} ) );

jest.mock( '@wordpress/editor', () => ( {
	__esModule: true,
	store: { name: 'core/editor' },
} ) );

jest.mock( '@wordpress/block-editor', () => ( {
	__esModule: true,
	store: { name: 'core/block-editor' },
} ) );

jest.mock( '@wordpress/core-data', () => ( {
	__esModule: true,
	store: { name: 'core' },
} ) );

jest.mock( '@wordpress/notices', () => ( {
	__esModule: true,
	store: { name: 'core/notices' },
} ) );

jest.mock( '../../../src/settings', () => ( {
	__esModule: true,
	isPublicWebAffordancesEnabled: () => true,
} ) );

jest.mock( '../../../src/hooks/useCollectionDependentPages', () => ( {
	__esModule: true,
	default: () => ( {
		isLoading: false,
		dependentPages: [],
		error: null,
	} ),
} ) );

jest.mock( '../../../src/components/PublishToggle', () => ( {
	__esModule: true,
	default: ( { disabled, isPublic, onToggle, onRequestUnpublish } ) => (
		<button
			type="button"
			disabled={ disabled }
			onClick={ isPublic ? onRequestUnpublish : onToggle }
		>
			{ isPublic ? 'Unpublish' : 'Publish' }
		</button>
	),
} ) );

import { useDispatch, useRegistry, useSelect } from '@wordpress/data';
import { store as editorStore } from '@wordpress/editor';
import { store as blockEditorStore } from '@wordpress/block-editor';
import { store as coreStore } from '@wordpress/core-data';
import { store as noticesStore } from '@wordpress/notices';

import DocumentPublishToggle from '../../../src/components/DocumentPublishToggle';

const editorDispatch = {
	editPost: jest.fn(),
	savePost: jest.fn(),
};
const coreDispatch = {
	saveEntityRecord: jest.fn(),
};
const noticesDispatch = {
	createErrorNotice: jest.fn(),
	removeNotice: jest.fn(),
};
const coreResolve = {
	getEntityRecord: jest.fn(),
};
const registry = {
	resolveSelect: jest.fn(),
};

let editorState;
let blocks;
let record;

beforeEach( () => {
	jest.clearAllMocks();

	editorState = {
		status: 'private',
		link: 'https://example.test/doc/',
		title: 'Published page',
		isSaving: false,
	};
	blocks = [];
	record = { id: 7, cortext_defines_trait: false };

	coreDispatch.saveEntityRecord.mockResolvedValue( { id: 44 } );
	coreResolve.getEntityRecord.mockImplementation(
		async ( kind, name, id ) => ( {
			id,
			status: 'private',
		} )
	);
	registry.resolveSelect.mockImplementation( ( store ) => {
		if ( store === coreStore ) {
			return coreResolve;
		}
		return {};
	} );
	useRegistry.mockReturnValue( registry );

	useDispatch.mockImplementation( ( store ) => {
		if ( store === editorStore ) {
			return editorDispatch;
		}
		if ( store === coreStore ) {
			return coreDispatch;
		}
		if ( store === noticesStore ) {
			return noticesDispatch;
		}
		return {};
	} );

	useSelect.mockImplementation( ( mapSelect ) =>
		mapSelect( ( store ) => {
			if ( store === editorStore ) {
				return {
					getEditedPostAttribute: ( key ) => editorState[ key ],
					isSavingPost: () => editorState.isSaving,
				};
			}
			if ( store === blockEditorStore ) {
				return {
					getBlocks: () => blocks,
				};
			}
			if ( store === coreStore ) {
				return {
					getEntityRecord: () => record,
				};
			}
			return {};
		} )
	);
} );

describe( 'DocumentPublishToggle', () => {
	it( 'publishes referenced collections before publishing the document', async () => {
		blocks = [
			null,
			{
				name: 'core/group',
				attributes: {},
				innerBlocks: [
					undefined,
					{
						name: 'cortext/data-view',
						attributes: { collectionId: 44 },
						innerBlocks: [],
					},
				],
			},
		];

		render( <DocumentPublishToggle postId={ 7 } /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Publish' } ) );

		await waitFor( () =>
			expect( coreDispatch.saveEntityRecord ).toHaveBeenCalledWith(
				'postType',
				'crtxt_document',
				{ id: 44, status: 'publish' },
				{ throwOnError: true }
			)
		);
		expect( registry.resolveSelect ).toHaveBeenCalledWith( coreStore );
		expect( coreResolve.getEntityRecord ).toHaveBeenCalledWith(
			'postType',
			'crtxt_document',
			44,
			{ context: 'edit' }
		);
		expect( editorDispatch.editPost ).toHaveBeenCalledWith( {
			status: 'publish',
		} );
		expect( editorDispatch.savePost ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'does not publish any referenced collection when one is archived', async () => {
		blocks = [
			{
				name: 'cortext/data-view',
				attributes: { collectionId: 43 },
				innerBlocks: [],
			},
			{
				name: 'cortext/data-view',
				attributes: { collectionId: 44 },
				innerBlocks: [],
			},
		];
		coreResolve.getEntityRecord.mockImplementation(
			async ( kind, name, id ) => ( {
				id,
				status: id === 44 ? 'crtxt_archived' : 'private',
			} )
		);

		render( <DocumentPublishToggle postId={ 7 } /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Publish' } ) );

		await waitFor( () =>
			expect( noticesDispatch.createErrorNotice ).toHaveBeenCalledWith(
				"Couldn't publish this document because it references an archived collection. Restore the collection first.",
				{
					id: 'cortext-document-publish-error',
					type: 'snackbar',
				}
			)
		);
		expect( coreResolve.getEntityRecord ).toHaveBeenCalledTimes( 2 );
		expect( coreDispatch.saveEntityRecord ).not.toHaveBeenCalled();
		expect( editorDispatch.editPost ).not.toHaveBeenCalled();
		expect( editorDispatch.savePost ).not.toHaveBeenCalled();
	} );

	it( 'does not publish when a referenced collection cannot be resolved', async () => {
		blocks = [
			{
				name: 'cortext/data-view',
				attributes: { collectionId: 44 },
				innerBlocks: [],
			},
		];
		coreResolve.getEntityRecord.mockResolvedValue( null );

		render( <DocumentPublishToggle postId={ 7 } /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Publish' } ) );

		await waitFor( () =>
			expect( noticesDispatch.createErrorNotice ).toHaveBeenCalled()
		);
		expect( coreDispatch.saveEntityRecord ).not.toHaveBeenCalled();
		expect( editorDispatch.editPost ).not.toHaveBeenCalled();
		expect( editorDispatch.savePost ).not.toHaveBeenCalled();
	} );

	it( 'does not publish when resolving a referenced collection fails', async () => {
		blocks = [
			{
				name: 'cortext/data-view',
				attributes: { collectionId: 44 },
				innerBlocks: [],
			},
		];
		coreResolve.getEntityRecord.mockRejectedValue(
			new Error( 'Could not load collection' )
		);

		render( <DocumentPublishToggle postId={ 7 } /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Publish' } ) );

		await waitFor( () =>
			expect( noticesDispatch.createErrorNotice ).toHaveBeenCalled()
		);
		expect( coreDispatch.saveEntityRecord ).not.toHaveBeenCalled();
		expect( editorDispatch.editPost ).not.toHaveBeenCalled();
		expect( editorDispatch.savePost ).not.toHaveBeenCalled();
	} );

	it( 'hides publishing for an unpublished row (carries a trait, does not define one)', () => {
		record = {
			id: 7,
			cortext_defines_trait: false,
			crtxt_trait: [ 12 ],
		};
		editorState.status = 'private';

		const { container } = render( <DocumentPublishToggle postId={ 7 } /> );

		expect( screen.queryByRole( 'button' ) ).toBeNull();
		expect( container.firstChild ).toBeNull();
	} );

	it( 'keeps the unpublish control for an already-public row', () => {
		record = {
			id: 7,
			cortext_defines_trait: false,
			crtxt_trait: [ 12 ],
		};
		editorState.status = 'publish';

		render( <DocumentPublishToggle postId={ 7 } /> );

		expect(
			screen.getByRole( 'button', { name: 'Unpublish' } )
		).toBeTruthy();
	} );

	it( 'keeps publishing for a collection (defines its own trait)', () => {
		record = {
			id: 7,
			cortext_defines_trait: true,
			crtxt_trait: [ 7 ],
		};

		render( <DocumentPublishToggle postId={ 7 } /> );

		expect(
			screen.getByRole( 'button', { name: 'Publish' } )
		).toBeTruthy();
	} );

	it( 'disables publishing while a document is archived', () => {
		editorState.status = 'crtxt_archived';

		render( <DocumentPublishToggle postId={ 7 } /> );

		const publish = screen.getByRole( 'button', { name: 'Publish' } );
		expect( publish ).toBeDisabled();
		fireEvent.click( publish );
		expect( editorDispatch.editPost ).not.toHaveBeenCalled();
		expect( editorDispatch.savePost ).not.toHaveBeenCalled();
	} );
} );
