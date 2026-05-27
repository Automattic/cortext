import { __, sprintf } from '@wordpress/i18n';
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

import './ImportPane.scss';
import ImportEntriesTable from './ImportEntriesTable';
import { extractAll, extractCollection, runImport } from './notionImport';

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

			runImport( key, collection.id, ( progress ) => {
				setImportJobs( ( prev ) => ( {
					...prev,
					[ collection.id ]: {
						status: progress.status === 'done' ? 'done' : 'running',
						processed: progress.processed ?? 0,
						collection_id: progress.collection_id,
						message: null,
					},
				} ) );
			} )
				.then( ( final ) => {
					setImportJobs( ( prev ) => ( {
						...prev,
						[ collection.id ]: {
							status: 'done',
							processed: final.processed ?? 0,
							collection_id: final.collection_id,
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
		[ key ]
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
			{ collections.map( ( c ) => {
				const job = importJobs?.[ c.id ];
				return (
					<li
						key={ c.id }
						className="cortext-import-collections__item"
					>
						<Button
							variant="link"
							onClick={ () => onSelect( c.id ) }
							aria-pressed={ selectedId === c.id }
						>
							{ c.title || __( '(untitled)', 'cortext' ) }
						</Button>
						<Text variant="muted">
							{ sprintf(
								/* translators: %d: number of fields in the collection schema */
								__( '%d fields', 'cortext' ),
								c.fields.length
							) }
						</Text>
						<ImportButton
							className="cortext-import-collections__import"
							job={ job }
							onClick={ () => onImport( c ) }
						/>
					</li>
				);
			} ) }
		</ul>
	);
}

function ImportButton( { job, className, onClick } ) {
	const status = job?.status ?? 'idle';
	const processed = job?.processed ?? 0;

	let label;
	switch ( status ) {
		case 'running':
			label = processed
				? sprintf(
						/* translators: %d: number of rows imported so far */
						__( 'Importing — %d', 'cortext' ),
						processed
				  )
				: __( 'Importing…', 'cortext' );
			break;
		case 'done':
			label = sprintf(
				/* translators: %d: total rows imported */
				__( 'Imported (%d) — Import again', 'cortext' ),
				processed
			);
			break;
		case 'error':
			label = __( 'Failed — retry', 'cortext' );
			break;
		default:
			label = __( 'Import', 'cortext' );
	}

	return (
		<Button
			className={ className }
			variant={ status === 'error' ? 'primary' : 'secondary' }
			size="compact"
			onClick={ onClick }
			disabled={ status === 'running' }
			aria-busy={ status === 'running' }
			label={
				status === 'error' && job?.message ? job.message : undefined
			}
		>
			{ label }
		</Button>
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
