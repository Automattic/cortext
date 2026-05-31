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
	default: ( { isPublic, onToggle, onRequestUnpublish } ) => (
		<button
			type="button"
			onClick={ isPublic ? onRequestUnpublish : onToggle }
		>
			{ isPublic ? 'Unpublish' : 'Publish' }
		</button>
	),
} ) );

import { useDispatch, useSelect } from '@wordpress/data';
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
			{
				name: 'core/group',
				attributes: {},
				innerBlocks: [
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
		expect( editorDispatch.editPost ).toHaveBeenCalledWith( {
			status: 'publish',
		} );
		expect( editorDispatch.savePost ).toHaveBeenCalledTimes( 1 );
	} );
} );
