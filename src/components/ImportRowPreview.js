// Preview for a single row from a Notion data source. Renders the row's
// properties (already in hand from the entries fetch) up top, then
// fetches and renders the body blocks below.
//
// Two presentations:
//   - `side` — fixed-position drawer on the right of the workspace, so
//     the table behind stays scannable.
//   - `modal` — centred large Modal for a fuller reading view.
// A button in the header swaps between them; the parent table holds the
// chosen mode so it persists across rows.

import { __ } from '@wordpress/i18n';
import { useEffect, useState } from '@wordpress/element';
import {
	Button,
	Modal,
	Notice,
	Spinner,
	// eslint-disable-next-line @wordpress/no-unsafe-wp-apis
	__experimentalHeading as Heading,
	// eslint-disable-next-line @wordpress/no-unsafe-wp-apis
	__experimentalHStack as HStack,
	// eslint-disable-next-line @wordpress/no-unsafe-wp-apis
	__experimentalText as Text,
	// eslint-disable-next-line @wordpress/no-unsafe-wp-apis
	__experimentalVStack as VStack,
} from '@wordpress/components';
import { close, fullscreen, sidebar as sidebarIcon } from '@wordpress/icons';

import './ImportRowPreview.scss';
import { renderCell } from './ImportEntriesTable';
import ImportPageBlocks from './ImportPageBlocks';
import { fetchPageBlocks } from './notionImport';

const NOTION_KEY_STORAGE = 'cortext.notionKey';

export default function ImportRowPreview( {
	collection,
	row,
	mode,
	onModeChange,
	onClose,
} ) {
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

	// Drop the title field — it's already the heading.
	const propertyFields = collection.fields.filter(
		( f ) => f.type !== 'title'
	);

	const hasBlocks = state.status === 'loaded' && state.blocks?.length > 0;

	const body = (
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
				{ ( state.status === 'pending' ||
					state.status === 'loading' ) && <Spinner /> }
				{ state.status === 'error' && (
					<Notice status="error" isDismissible={ false }>
						{ state.message }
					</Notice>
				) }
				{ hasBlocks && (
					<>
						<Heading level={ 3 }>
							{ __( 'Content', 'cortext' ) }
						</Heading>
						<ImportPageBlocks blocks={ state.blocks } />
					</>
				) }
				{ state.status === 'loaded' && ! hasBlocks && (
					<Text variant="muted">
						{ __( 'This page has no content.', 'cortext' ) }
					</Text>
				) }
			</div>
		</VStack>
	);

	if ( mode === 'modal' ) {
		return (
			<Modal
				title={ title }
				onRequestClose={ onClose }
				className="cortext-import-row-preview cortext-import-row-preview--modal"
				size="large"
				headerActions={
					<Button
						icon={ sidebarIcon }
						label={ __( 'Open as side panel', 'cortext' ) }
						onClick={ () => onModeChange( 'side' ) }
					/>
				}
			>
				{ body }
			</Modal>
		);
	}

	return (
		<aside
			className="cortext-import-row-preview cortext-import-row-preview--side"
			aria-label={ __( 'Row preview', 'cortext' ) }
		>
			<header className="cortext-import-row-preview__header">
				<Heading level={ 3 }>{ title }</Heading>
				<HStack spacing={ 1 } justify="flex-end" expanded={ false }>
					<Button
						icon={ fullscreen }
						label={ __( 'Open as modal', 'cortext' ) }
						onClick={ () => onModeChange( 'modal' ) }
					/>
					<Button
						icon={ close }
						label={ __( 'Close', 'cortext' ) }
						onClick={ onClose }
					/>
				</HStack>
			</header>
			<div className="cortext-import-row-preview__scroll">{ body }</div>
		</aside>
	);
}
