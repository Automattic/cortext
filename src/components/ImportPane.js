import { __, sprintf } from '@wordpress/i18n';
import { useDispatch } from '@wordpress/data';
import { useCallback, useEffect, useState } from '@wordpress/element';
import {
	Button,
	Card,
	CardBody,
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
import { extractCollections, runImport } from './notionImport';
import { COLLECTION_QUERY, FULL_PAGE_COLLECTION_QUERY } from '../collections';
import { computeCollectionUri } from '../router/useResolveEntity';

const COLLECTION_POST_TYPE = 'crtxt_collection';

const NOTION_KEY_STORAGE = 'cortext.notionKey';

export default function ImportPane() {
	/*
	 * Notion API key management
	 */

	const [ notionApiKey, setNotionApiKey ] = useState( () =>
		window.localStorage.getItem( NOTION_KEY_STORAGE )
	);

	const [ isChangingNotionApiKey, setIsChangingNotionApiKey ] =
		useState( false );

	// Drop stale per-card import progress whenever the key changes.
	useEffect( () => {
		setImportJobs( {} );
	}, [ notionApiKey ] );

	/*
	 * Extract available Notion collections
	 */

	const {
		data: collections,
		isResolving: isResolvingCollections,
		hasResolved: hasResolvedCollections,
		error: collectionResolutionError,
		retry: forceResolveCollections,
	} = useExtractNotionCollections( notionApiKey );

	// Per-collection import progress, keyed by Notion data-source id:
	// { status: 'idle'|'running'|'done'|'error', processed: 0, message?, collection_id? }
	const [ importJobs, setImportJobs ] = useState( {} );
	const { invalidateResolution } = useDispatch( 'core' );

	// Run the server-side import for one collection. The client orchestrates
	// the start → tick loop and surfaces progress per Notion data-source id.
	// Multiple collections can be imported in parallel; the per-card button
	// state (Importing… / Open / Try again) is the lock against re-entry.
	const importCollection = useCallback(
		( collection ) => {
			if ( ! notionApiKey || ! collection?.id ) {
				return;
			}

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

			runImport( notionApiKey, collection.id, ( progress ) => {
				refreshSidebarOnce( progress );
				setImportJobs( ( prev ) => ( {
					...prev,
					[ collection.id ]: {
						...( prev[ collection.id ] ?? {} ),
						status: progress.status === 'done' ? 'done' : 'running',
						processed: progress.processed ?? 0,
						collection_id:
							progress.collection_id ??
							prev[ collection.id ]?.collection_id,
						collection_slug:
							progress.collection_slug ??
							prev[ collection.id ]?.collection_slug,
						message: null,
					},
				} ) );
			} ).catch( ( err ) => {
				setImportJobs( ( prev ) => ( {
					...prev,
					[ collection.id ]: {
						status: 'error',
						processed: prev[ collection.id ]?.processed ?? 0,
						message: err?.message ?? String( err ),
					},
				} ) );
			} );
		},
		[ notionApiKey, invalidateResolution ]
	);

	const handleSaveKey = ( nextKey ) => {
		window.localStorage.setItem( NOTION_KEY_STORAGE, nextKey );
		setIsChangingNotionApiKey( false );
		setNotionApiKey( nextKey );
	};
	const handleChangeKey = () => setIsChangingNotionApiKey( true );
	const handleCancelChangeKey = () => setIsChangingNotionApiKey( false );
	const handleForgetKey = () => {
		window.localStorage.removeItem( NOTION_KEY_STORAGE );
		setIsChangingNotionApiKey( false );
		setNotionApiKey( null );
	};
	const handleRetry = () => {
		setImportJobs( {} );
		forceResolveCollections();
	};

	const showForm = ! notionApiKey || isChangingNotionApiKey;

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
					onCancel={
						notionApiKey ? handleCancelChangeKey : undefined
					}
				/>
			) : (
				<>
					<HStack justify="flex-start">
						<Button variant="secondary" onClick={ handleChangeKey }>
							{ __( 'Change Notion token', 'cortext' ) }
						</Button>
						<Button
							variant="secondary"
							isDestructive={ true }
							onClick={ handleForgetKey }
						>
							{ __( 'Forget token', 'cortext' ) }
						</Button>
					</HStack>
					<ImportBody
						collections={ collections }
						isResolving={ isResolvingCollections }
						hasResolved={ hasResolvedCollections }
						error={ collectionResolutionError }
						onRetry={ handleRetry }
						onImport={ importCollection }
						importJobs={ importJobs }
					/>
				</>
			) }
		</div>
	);
}

function ImportBody( {
	collections,
	isResolving,
	hasResolved,
	error,
	onRetry,
	onImport,
	importJobs,
} ) {
	if ( hasResolved && error ) {
		return (
			<VStack spacing={ 3 } alignment="left">
				<Notice status="error" isDismissible={ false }>
					{ error }
				</Notice>
				<Button variant="primary" onClick={ onRetry }>
					{ __( 'Retry', 'cortext' ) }
				</Button>
			</VStack>
		);
	}
	if ( isResolving || ! hasResolved ) {
		return (
			<HStack justify="flex-start" expanded={ false }>
				<Spinner />
				<Text variant="muted">
					{ __( 'Searching Notion…', 'cortext' ) }
				</Text>
			</HStack>
		);
	}

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
					onImport={ onImport }
					importJobs={ importJobs }
				/>
			</section>
		</VStack>
	);
}

function CollectionsList( { collections, onImport, importJobs } ) {
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
					onImport={ onImport }
				/>
			) ) }
		</ul>
	);
}

// One row in the collections list — title + status + action. Renders as
// a card; error state adds an extra line below for the message.
function CollectionCard( { collection, job, onImport } ) {
	const navigate = useNavigate();
	const status = job?.status ?? 'idle';
	const processed = job?.processed ?? 0;

	let statusLine = null;
	switch ( status ) {
		case 'error':
			statusLine = __( 'Import failed.', 'cortext' );
			break;

		case 'running':
			if ( processed ) {
				statusLine = sprintf(
					/* translators: %d: rows processed */
					__( 'Importing %d rows…', 'cortext' ),
					processed
				);
			}
			break;

		case 'done':
			if ( processed ) {
				statusLine = sprintf(
					/* translators: %d: rows processed */
					__( '%d rows imported.', 'cortext' ),
					processed
				);
			}

			break;
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
		<li className="cortext-import-collections__item" data-status={ status }>
			<Card size="small">
				<CardBody>
					<div className="cortext-import-collections__card-row">
						<HStack>
							<Text className="cortext-import-collections__card-title">
								{ collection.title ||
									__( '(untitled)', 'cortext' ) }
							</Text>
							<HStack expanded={ false }>
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
							</HStack>
						</HStack>
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
				</CardBody>
			</Card>
		</li>
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
						'Paste your Notion connection token to begin. The token is stored in this browser only.',
						'cortext'
					) }
				</Text>
				<TextControl
					__next40pxDefaultSize
					__nextHasNoMarginBottom
					label={ __( 'Notion connection token', 'cortext' ) }
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

// Resolves the Notion collections reachable with `key`. Shape echoes
// `useQuerySelect`: `data` is the collections array once resolved, and
// `(hasResolved && error)` indicates a terminal failure.
function useExtractNotionCollections( key ) {
	const [ retryToken, setRetryToken ] = useState( 0 );
	const [ resolution, setResolution ] = useState( () => ( {
		isResolving: !! key,
		hasResolved: false,
		data: null,
		error: null,
	} ) );

	useEffect( () => {
		if ( ! key ) {
			setResolution( {
				isResolving: false,
				hasResolved: false,
				data: null,
				error: null,
			} );
			return undefined;
		}

		let cancelled = false;
		setResolution( {
			isResolving: true,
			hasResolved: false,
			data: null,
			error: null,
		} );

		extractCollections( key )
			.then( ( { collections } ) => {
				if ( ! cancelled ) {
					setResolution( {
						isResolving: false,
						hasResolved: true,
						data: collections,
						error: null,
					} );
				}
			} )
			.catch( ( err ) => {
				if ( ! cancelled ) {
					setResolution( {
						isResolving: false,
						hasResolved: true,
						data: null,
						error: err?.message ?? String( err ),
					} );
				}
			} );

		return () => {
			cancelled = true;
		};
	}, [ key, retryToken ] );

	const retry = useCallback( () => {
		setRetryToken( ( n ) => n + 1 );
	}, [] );

	return { ...resolution, retry };
}
