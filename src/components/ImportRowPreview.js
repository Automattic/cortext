// Modal preview for a single row from a Notion data source. Shows the
// row's properties (already in hand from the entries fetch) up top, then
// fetches and renders the body blocks below.

import { __ } from '@wordpress/i18n';
import { useEffect, useState } from '@wordpress/element';
import {
	Modal,
	Notice,
	Spinner,
	// eslint-disable-next-line @wordpress/no-unsafe-wp-apis
	__experimentalHeading as Heading,
	// eslint-disable-next-line @wordpress/no-unsafe-wp-apis
	__experimentalText as Text,
	// eslint-disable-next-line @wordpress/no-unsafe-wp-apis
	__experimentalVStack as VStack,
} from '@wordpress/components';

import './ImportRowPreview.scss';
import { renderCell } from './ImportEntriesTable';
import ImportPageBlocks from './ImportPageBlocks';
import { fetchPageBlocks } from './notionImport';

const NOTION_KEY_STORAGE = 'cortext.notionKey';

export default function ImportRowPreview( { collection, row, onClose } ) {
	const [ state, setState ] = useState( { status: 'pending' } );

	useEffect( () => {
		if ( ! row?.id ) {
			return undefined;
		}
		const key = window.localStorage.getItem( NOTION_KEY_STORAGE );
		if ( ! key ) {
			setState( {
				status: 'error',
				message: __( 'No Notion key in localStorage.', 'cortext' ),
			} );
			return undefined;
		}
		let cancelled = false;
		setState( { status: 'loading' } );
		fetchPageBlocks( key, row.id )
			.then( ( blocks ) => {
				if ( ! cancelled ) {
					setState( { status: 'loaded', blocks } );
				}
			} )
			.catch( ( err ) => {
				if ( ! cancelled ) {
					setState( { status: 'error', message: err.message } );
				}
			} );
		return () => {
			cancelled = true;
		};
	}, [ row?.id ] );

	const title = row?.title || __( '(untitled)', 'cortext' );

	// Drop the title field — it's already the modal heading.
	const propertyFields = collection.fields.filter(
		( f ) => f.type !== 'title'
	);

	return (
		<Modal
			title={ title }
			onRequestClose={ onClose }
			className="cortext-import-row-preview"
			size="large"
		>
			<VStack spacing={ 5 } alignment="left">
				{ propertyFields.length > 0 && (
					<dl className="cortext-import-row-preview__properties">
						{ propertyFields.map( ( field ) => (
							<div
								key={ field.id }
								className="cortext-import-row-preview__property"
							>
								<dt>{ field.name }</dt>
								<dd>
									{ renderCell(
										field,
										row.values?.[ field.id ]
									) ?? (
										<Text variant="muted">
											{ __( 'Empty', 'cortext' ) }
										</Text>
									) }
								</dd>
							</div>
						) ) }
					</dl>
				) }
				<div className="cortext-import-row-preview__body">
					<Heading level={ 3 }>
						{ __( 'Content', 'cortext' ) }
					</Heading>
					{ ( state.status === 'pending' ||
						state.status === 'loading' ) && <Spinner /> }
					{ state.status === 'error' && (
						<Notice status="error" isDismissible={ false }>
							{ state.message }
						</Notice>
					) }
					{ state.status === 'loaded' && (
						<ImportPageBlocks blocks={ state.blocks } />
					) }
				</div>
			</VStack>
		</Modal>
	);
}
