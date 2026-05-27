import { __, sprintf } from '@wordpress/i18n';
import { useDispatch } from '@wordpress/data';
import { useCallback, useEffect, useRef, useState } from '@wordpress/element';
import {
	Button,
	Notice,
	Spinner,
	TextControl,
	// eslint-disable-next-line @wordpress/no-unsafe-wp-apis
	__experimentalHeading as Heading,
	// eslint-disable-next-line @wordpress/no-unsafe-wp-apis
	__experimentalHStack as HStack,
	// eslint-disable-next-line @wordpress/no-unsafe-wp-apis
	__experimentalText as Text,
	// eslint-disable-next-line @wordpress/no-unsafe-wp-apis
	__experimentalVStack as VStack,
} from '@wordpress/components';

import { useNavigate } from '@tanstack/react-router';

import './ImportPane.scss';
import ImportEntriesTable from './ImportEntriesTable';
import { extractAll, extractCollection, runImport } from './notionImport';
import { COLLECTION_QUERY, FULL_PAGE_COLLECTION_QUERY } from '../collections';
import { computeCollectionUri } from '../router/useResolveEntity';

const COLLECTION_POST_TYPE = 'crtxt_collection';

const NOTION_KEY_STORAGE = 'cortext.notionKey';

export default function ImportPane() {
	const [ key, setKey ] = useState( () =>
		window.localStorage.getItem( NOTION_KEY_STORAGE )
	);
	const [ isChangingKey, setIsChangingKey ] = useState( false );
	const [ retryToken, setRetryToken ] = useState( 0 );
	const [ state, setState ] = useState( { status: 'pending' } );
	const [ selectedId, setSelectedId ] = useState( null );
	const [ collectionData, setCollectionData ] = useState( {} );
	// Per-collection import progress, keyed by Notion data-source id:
	// { status: 'idle'|'running'|'done'|'error', processed: 0, message?, collection_id? }
	const [ importJobs, setImportJobs ] = useState( {} );
	// Mirrors which import is currently running so the Import button
	// can disable itself without racing the state update.
	const importsInFlightRef = useRef( new Set() );
	const { invalidateResolution } = useDispatch( 'core' );
	// Tracks which collection ids have an in-flight fetch so a fast
	// double-click on the same link doesn't kick off two parallel loads.
	const inflightRef = useRef( new Set() );

	useEffect( () => {
		if ( ! key ) {
			setState( { status: 'no-key' } );
			return undefined;
		}
		let cancelled = false;
		setState( { status: 'loading' } );
		setSelectedId( null );
		setCollectionData( {} );
		setImportJobs( {} );
		inflightRef.current = new Set();
		importsInFlightRef.current = new Set();

		extractAll( key )
			.then( ( payload ) => {
				if ( ! cancelled ) {
					setState( { status: 'loaded', payload } );
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
	}, [ key, retryToken ] );

	const loadCollection = useCallback(
		( id ) => {
			if ( ! key || ! id || inflightRef.current.has( id ) ) {
				return;
			}
			inflightRef.current.add( id );
			setCollectionData( ( prev ) => ( {
				...prev,
				[ id ]: { status: 'loading' },
			} ) );
			extractCollection( key, id )
				.then( ( { entries } ) => {
					setCollectionData( ( prev ) => ( {
						...prev,
						[ id ]: { status: 'loaded', entries },
					} ) );
				} )
				.catch( ( err ) => {
					setCollectionData( ( prev ) => ( {
						...prev,
						[ id ]: { status: 'error', message: err.message },
					} ) );
				} );
		},
		[ key ]
	);

	const selectCollection = useCallback(
		( id ) => {
			setSelectedId( id );
			loadCollection( id );
		},
		[ loadCollection ]
	);

	// Run the server-side import for one collection. The client orchestrates
	// the start → tick loop and surfaces progress per Notion data-source id.
	// Multiple collections can be imported in parallel; double-clicks on the
	// same row are guarded by `importsInFlightRef`.
	const importCollection = useCallback(
		( collection ) => {
			if ( ! key || ! collection?.id ) {
				return;
			}
			if ( importsInFlightRef.current.has( collection.id ) ) {
				return;
			}
			importsInFlightRef.current.add( collection.id );

			setImportJobs( ( prev ) => ( {
				...prev,
				[ collection.id ]: {
					status: 'running',
					processed: 0,
					message: null,
				},
			} ) );

			// Refresh the workspace sidebar as soon as the new Cortext
			// collection exists. The first onProgress fires right after
			// `/import/start` returns, which is when the collection
			// post is in the DB. We only need to invalidate once;
			// subsequent ticks only add rows under a different CPT, not
			// new `crtxt_collection` posts.
			let sidebarInvalidated = false;
			const refreshSidebarOnce = ( progress ) => {
				if ( sidebarInvalidated || ! progress.collection_id ) {
					return;
				}
				sidebarInvalidated = true;
				invalidateResolution( 'getEntityRecords', [
					'postType',
					COLLECTION_POST_TYPE,
					FULL_PAGE_COLLECTION_QUERY,
				] );
				invalidateResolution( 'getEntityRecords', [
					'postType',
					COLLECTION_POST_TYPE,
					COLLECTION_QUERY,
				] );
			};

			runImport( key, collection.id, ( progress ) => {
				refreshSidebarOnce( progress );
				setImportJobs( ( prev ) => ( {
					...prev,
					[ collection.id ]: {
						...( prev[ collection.id ] ?? {} ),
						status: progress.status === 'done' ? 'done' : 'running',
						processed: progress.processed ?? 0,
						total:
							progress.total ??
							prev[ collection.id ]?.total ??
							null,
						collection_id:
							progress.collection_id ??
							prev[ collection.id ]?.collection_id,
						collection_slug:
							progress.collection_slug ??
							prev[ collection.id ]?.collection_slug,
						message: null,
					},
				} ) );
			} )
				.then( ( final ) => {
					setImportJobs( ( prev ) => ( {
						...prev,
						[ collection.id ]: {
							...( prev[ collection.id ] ?? {} ),
							status: 'done',
							processed: final.processed ?? 0,
							total:
								final.total ??
								prev[ collection.id ]?.total ??
								null,
							collection_id:
								final.collection_id ??
								prev[ collection.id ]?.collection_id,
							collection_slug:
								final.collection_slug ??
								prev[ collection.id ]?.collection_slug,
							message: null,
						},
					} ) );
				} )
				.catch( ( err ) => {
					setImportJobs( ( prev ) => ( {
						...prev,
						[ collection.id ]: {
							status: 'error',
							processed: prev[ collection.id ]?.processed ?? 0,
							message: err?.message ?? String( err ),
						},
					} ) );
				} )
				.finally( () => {
					importsInFlightRef.current.delete( collection.id );
				} );
		},
		[ key, invalidateResolution ]
	);

	const handleSaveKey = ( nextKey ) => {
		window.localStorage.setItem( NOTION_KEY_STORAGE, nextKey );
		setIsChangingKey( false );
		setKey( nextKey );
	};
	const handleChangeKey = () => setIsChangingKey( true );
	const handleCancelChangeKey = () => setIsChangingKey( false );
	const handleRetry = () => setRetryToken( ( n ) => n + 1 );

	const showForm = ! key || isChangingKey;

	return (
		<div className="cortext-import-pane">
			<VStack spacing={ 1 }>
				<Heading level={ 2 }>{ __( 'Import', 'cortext' ) }</Heading>
				<Text variant="muted">
					{ __(
						'Bring content from Notion into Cortext.',
						'cortext'
					) }
				</Text>
			</VStack>
			{ showForm ? (
				<NoKeyForm
					onSave={ handleSaveKey }
					onCancel={ key ? handleCancelChangeKey : undefined }
				/>
			) : (
				<>
					<HStack justify="flex-start">
						<Button variant="secondary" onClick={ handleChangeKey }>
							{ __( 'Change key', 'cortext' ) }
						</Button>
					</HStack>
					<ImportBody
						state={ state }
						onRetry={ handleRetry }
						selectedId={ selectedId }
						onSelect={ selectCollection }
						onImport={ importCollection }
						importJobs={ importJobs }
						collectionData={ collectionData }
					/>
				</>
			) }
		</div>
	);
}

function ImportBody( {
	state,
	onRetry,
	selectedId,
	onSelect,
	onImport,
	importJobs,
	collectionData,
} ) {
	if ( state.status === 'pending' ) {
		return <Spinner />;
	}
	if ( state.status === 'error' ) {
		return (
			<VStack spacing={ 3 } alignment="left">
				<Notice status="error" isDismissible={ false }>
					{ state.message }
				</Notice>
				<Button variant="primary" onClick={ onRetry }>
					{ __( 'Retry', 'cortext' ) }
				</Button>
			</VStack>
		);
	}
	if ( state.status === 'loading' ) {
		return (
			<HStack justify="flex-start" expanded={ false }>
				<Spinner />
				<Text variant="muted">
					{ __( 'Searching Notion…', 'cortext' ) }
				</Text>
			</HStack>
		);
	}

	const { collections } = state.payload;
	const selected = selectedId
		? collections.find( ( c ) => c.id === selectedId ) ?? null
		: null;
	const selectedData = selectedId ? collectionData[ selectedId ] : null;

	return (
		<VStack spacing={ 6 }>
			<Text variant="muted">
				{ sprintf(
					/* translators: %d: number of Notion collections found */
					__( '%d collections', 'cortext' ),
					collections.length
				) }
			</Text>
			<section className="cortext-import-pane__section">
				<Heading level={ 3 }>
					{ __( 'Collections', 'cortext' ) }
				</Heading>
				<CollectionsList
					collections={ collections }
					selectedId={ selectedId }
					onSelect={ onSelect }
					onImport={ onImport }
					importJobs={ importJobs }
				/>
			</section>
			{ selected && (
				<section className="cortext-import-pane__section">
					<Heading level={ 3 }>{ selected.title }</Heading>
					<CollectionPanel
						collection={ selected }
						data={ selectedData }
					/>
				</section>
			) }
		</VStack>
	);
}

function CollectionsList( {
	collections,
	selectedId,
	onSelect,
	onImport,
	importJobs,
} ) {
	if ( collections.length === 0 ) {
		return (
			<Text variant="muted">
				{ __( 'No collections accessible with this key.', 'cortext' ) }
			</Text>
		);
	}
	return (
		<ul className="cortext-import-collections">
			{ collections.map( ( c ) => (
				<CollectionCard
					key={ c.id }
					collection={ c }
					job={ importJobs?.[ c.id ] }
					isSelected={ selectedId === c.id }
					onSelect={ onSelect }
					onImport={ onImport }
				/>
			) ) }
		</ul>
	);
}

// One row in the collections list — title + status + action. Renders as
// a card; error state adds an extra line below for the message.
function CollectionCard( { collection, job, isSelected, onSelect, onImport } ) {
	const navigate = useNavigate();
	const status = job?.status ?? 'idle';
	const processed = job?.processed ?? 0;

	let statusLine = null;
	if ( processed && ( status === 'running' || status === 'done' ) ) {
		statusLine =
			status === 'running'
				? sprintf(
						/* translators: %d: rows processed */
						__( 'Importing %d rows…', 'cortext' ),
						processed
				  )
				: sprintf(
						/* translators: %d: rows processed */
						__( '%d rows imported.', 'cortext' ),
						processed
				  );
	}

	const openTo =
		job?.collection_id && job?.collection_slug
			? computeCollectionUri( {
					id: job.collection_id,
					slug: job.collection_slug,
			  } )
			: null;

	// Pick the one button that fits the current state.
	let actionButton;
	if ( status === 'running' ) {
		actionButton = (
			<Button variant="secondary" size="compact" disabled aria-busy>
				{ __( 'Importing…', 'cortext' ) }
			</Button>
		);
	} else if ( status === 'done' ) {
		actionButton = (
			<Button
				variant="primary"
				size="compact"
				disabled={ ! openTo }
				onClick={
					openTo
						? () =>
								navigate( {
									to: '/$',
									params: { _splat: openTo },
								} )
						: undefined
				}
			>
				{ __( 'Open', 'cortext' ) }
			</Button>
		);
	} else if ( status === 'error' ) {
		actionButton = (
			<Button
				variant="primary"
				size="compact"
				onClick={ () => onImport( collection ) }
			>
				{ __( 'Try again', 'cortext' ) }
			</Button>
		);
	} else {
		actionButton = (
			<Button
				variant="secondary"
				size="compact"
				onClick={ () => onImport( collection ) }
			>
				{ __( 'Import', 'cortext' ) }
			</Button>
		);
	}

	return (
		<li className="cortext-import-collections__card" data-status={ status }>
			<div className="cortext-import-collections__card-row">
				<Button
					className="cortext-import-collections__card-title"
					variant="link"
					onClick={ () => onSelect( collection.id ) }
					aria-pressed={ isSelected }
				>
					{ collection.title || __( '(untitled)', 'cortext' ) }
				</Button>
				{ statusLine && (
					<Text
						variant="muted"
						className="cortext-import-collections__card-status"
					>
						{ statusLine }
					</Text>
				) }
				<div className="cortext-import-collections__card-action">
					{ actionButton }
				</div>
			</div>
			{ status === 'error' && job?.message && (
				<Text
					variant="muted"
					className="cortext-import-collections__card-error"
				>
					{ sprintf(
						/* translators: %s: upstream error message */
						__( 'Error: %s', 'cortext' ),
						job.message
					) }
				</Text>
			) }
		</li>
	);
}

function CollectionPanel( { collection, data } ) {
	if ( ! data || data.status === 'loading' ) {
		return (
			<HStack justify="flex-start" expanded={ false }>
				<Spinner />
				<Text variant="muted">
					{ __( 'Loading rows…', 'cortext' ) }
				</Text>
			</HStack>
		);
	}
	if ( data.status === 'error' ) {
		return (
			<Notice status="error" isDismissible={ false }>
				{ data.message }
			</Notice>
		);
	}
	return (
		<ImportEntriesTable
			// Force a fresh table per collection so initial selection
			// (and any other state) resets when the user switches.
			key={ collection.id }
			collection={ collection }
			entries={ data.entries }
		/>
	);
}

function NoKeyForm( { onSave, onCancel } ) {
	const [ value, setValue ] = useState( '' );
	const trimmed = value.trim();
	const handleSubmit = ( event ) => {
		event.preventDefault();
		if ( trimmed ) {
			onSave( trimmed );
		}
	};
	return (
		<form className="cortext-import-pane__form" onSubmit={ handleSubmit }>
			<VStack spacing={ 4 } alignment="left">
				<Text>
					{ __(
						'Paste your Notion integration token to begin. The key is stored in this browser only.',
						'cortext'
					) }
				</Text>
				<TextControl
					__next40pxDefaultSize
					__nextHasNoMarginBottom
					label={ __( 'Notion integration token', 'cortext' ) }
					type="password"
					value={ value }
					onChange={ setValue }
					autoComplete="off"
					spellCheck={ false }
				/>
				<HStack justify="flex-start">
					<Button
						__next40pxDefaultSize
						variant="primary"
						type="submit"
						disabled={ ! trimmed }
					>
						{ __( 'Connect to Notion', 'cortext' ) }
					</Button>
					{ onCancel && (
						<Button
							__next40pxDefaultSize
							variant="tertiary"
							onClick={ onCancel }
						>
							{ __( 'Cancel', 'cortext' ) }
						</Button>
					) }
				</HStack>
			</VStack>
		</form>
	);
}
