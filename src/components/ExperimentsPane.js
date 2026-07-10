import apiFetch from '@wordpress/api-fetch';
import {
	Notice,
	Spinner,
	ToggleControl,
	// eslint-disable-next-line @wordpress/no-unsafe-wp-apis
	__experimentalHeading as Heading,
	// eslint-disable-next-line @wordpress/no-unsafe-wp-apis
	__experimentalText as Text,
	// eslint-disable-next-line @wordpress/no-unsafe-wp-apis
	__experimentalVStack as VStack,
} from '@wordpress/components';
import { useDispatch } from '@wordpress/data';
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { store as noticesStore } from '@wordpress/notices';

import { syncCortextExperiments } from '../settings';

import './ExperimentsPane.scss';

function groupExperiments( experiments ) {
	const groups = new Map();
	for ( const experiment of experiments ?? [] ) {
		const group = experiment.group || __( 'Other', 'cortext' );
		if ( ! groups.has( group ) ) {
			groups.set( group, [] );
		}
		groups.get( group ).push( experiment );
	}
	return Array.from( groups.entries() ).map( ( [ label, items ] ) => ( {
		label,
		items,
	} ) );
}

function applyPendingChanges( experiments, pendingChanges ) {
	return experiments.map( ( experiment ) =>
		pendingChanges.has( experiment.id )
			? {
					...experiment,
					enabled: pendingChanges.get( experiment.id ).enabled,
			  }
			: experiment
	);
}

function getEnabledValues( experiments ) {
	return new Map(
		experiments.map( ( experiment ) => [
			experiment.id,
			experiment.enabled === true,
		] )
	);
}

export default function ExperimentsPane() {
	const [ state, setState ] = useState( {
		canManage: false,
		experiments: [],
		isLoading: true,
		error: null,
	} );
	const pendingChangesRef = useRef( new Map() );
	const confirmedEnabledRef = useRef( new Map() );
	const saveQueueRef = useRef( [] );
	const isProcessingQueueRef = useRef( false );
	const nextChangeVersionRef = useRef( 0 );
	const { createErrorNotice, createSuccessNotice } =
		useDispatch( noticesStore );

	useEffect( () => {
		let cancelled = false;
		apiFetch( { path: '/cortext/v1/experiments' } )
			.then( ( response ) => {
				if ( cancelled ) {
					return;
				}
				const experiments = Array.isArray( response?.experiments )
					? response.experiments
					: [];
				confirmedEnabledRef.current = getEnabledValues( experiments );
				setState( {
					canManage: response?.canManage === true,
					experiments,
					isLoading: false,
					error: null,
				} );
			} )
			.catch( () => {
				if ( cancelled ) {
					return;
				}
				setState( {
					canManage: false,
					experiments: [],
					isLoading: false,
					error: __( "Couldn't load experiments.", 'cortext' ),
				} );
			} );
		return () => {
			cancelled = true;
		};
	}, [] );

	const groups = useMemo(
		() => groupExperiments( state.experiments ),
		[ state.experiments ]
	);

	const processSaveQueue = useCallback( async () => {
		if ( isProcessingQueueRef.current ) {
			return;
		}

		isProcessingQueueRef.current = true;
		try {
			while ( saveQueueRef.current.length > 0 ) {
				const { id, enabled, version } = saveQueueRef.current.shift();
				try {
					const response = await apiFetch( {
						path: '/cortext/v1/experiments',
						method: 'PUT',
						data: { enabled: { [ id ]: enabled } },
					} );
					const experiments = Array.isArray( response?.experiments )
						? response.experiments
						: null;
					if ( experiments ) {
						confirmedEnabledRef.current =
							getEnabledValues( experiments );
						syncCortextExperiments( experiments );
					} else {
						confirmedEnabledRef.current.set( id, enabled );
					}
					if (
						pendingChangesRef.current.get( id )?.version === version
					) {
						pendingChangesRef.current.delete( id );
					}
					const visibleExperiments = experiments
						? applyPendingChanges(
								experiments,
								new Map( pendingChangesRef.current )
						  )
						: null;
					setState( ( current ) => ( {
						...current,
						canManage: response?.canManage === true,
						experiments: visibleExperiments ?? current.experiments,
						error: null,
					} ) );
					createSuccessNotice(
						__( 'Experiment updated.', 'cortext' ),
						{
							id: 'cortext-experiments-updated',
							type: 'snackbar',
						}
					);
				} catch {
					if (
						pendingChangesRef.current.get( id )?.version === version
					) {
						pendingChangesRef.current.delete( id );
						const confirmedEnabled =
							confirmedEnabledRef.current.get( id );
						setState( ( current ) => ( {
							...current,
							experiments: current.experiments.map(
								( experiment ) =>
									experiment.id === id &&
									typeof confirmedEnabled === 'boolean'
										? {
												...experiment,
												enabled: confirmedEnabled,
										  }
										: experiment
							),
						} ) );
					}
					createErrorNotice(
						__( "Couldn't update this experiment.", 'cortext' ),
						{
							id: 'cortext-experiments-update-failed',
							type: 'snackbar',
						}
					);
				}
			}
		} finally {
			isProcessingQueueRef.current = false;
		}
	}, [ createErrorNotice, createSuccessNotice ] );

	const updateExperiment = useCallback(
		( id, enabled ) => {
			const currentExperiment = state.experiments.find(
				( current ) => current.id === id
			);
			if ( ! currentExperiment ) {
				return;
			}

			const currentEnabled = pendingChangesRef.current.has( id )
				? pendingChangesRef.current.get( id ).enabled
				: currentExperiment.enabled === true;
			if ( currentEnabled === enabled ) {
				return;
			}

			const version = ++nextChangeVersionRef.current;
			pendingChangesRef.current.set( id, { enabled, version } );
			setState( ( current ) => ( {
				...current,
				experiments: current.experiments.map( ( experiment ) =>
					experiment.id === id
						? { ...experiment, enabled }
						: experiment
				),
			} ) );
			saveQueueRef.current.push( { id, enabled, version } );
			void processSaveQueue();
		},
		[ processSaveQueue, state.experiments ]
	);

	return (
		<div className="cortext-experiments-pane">
			<VStack spacing={ 2 }>
				<Heading level={ 2 }>
					{ __( 'Experiments', 'cortext' ) }
				</Heading>
				<Text
					className="cortext-experiments-pane__description"
					variant="muted"
				>
					{ __(
						'Try Cortext features that are still in development.',
						'cortext'
					) }
				</Text>
			</VStack>
			{ state.isLoading ? (
				<div className="cortext-experiments-pane__loading">
					<Spinner />
					<Text variant="muted">
						{ __( 'Loading experiments…', 'cortext' ) }
					</Text>
				</div>
			) : null }
			{ state.error ? (
				<Notice status="error" isDismissible={ false }>
					{ state.error }
				</Notice>
			) : null }
			{ ! state.isLoading && ! state.error && ! state.canManage ? (
				<Notice status="warning" isDismissible={ false }>
					{ __(
						'You need to be a site administrator to change experiments.',
						'cortext'
					) }
				</Notice>
			) : null }
			{ ! state.isLoading &&
			! state.error &&
			state.canManage &&
			state.experiments.length === 0 ? (
				<Text variant="muted">
					{ __( 'No experiments yet.', 'cortext' ) }
				</Text>
			) : null }
			{ ! state.isLoading && ! state.error && state.canManage
				? groups.map( ( group ) => (
						<section
							key={ group.label }
							className="cortext-experiments-pane__group"
						>
							<Heading level={ 3 }>{ group.label }</Heading>
							<div className="cortext-experiments-pane__toggles">
								{ group.items.map( ( experiment ) => (
									<div
										key={ experiment.id }
										className="cortext-experiments-pane__toggle"
									>
										<ToggleControl
											label={ experiment.label }
											help={ experiment.description }
											checked={
												experiment.enabled === true
											}
											onChange={ ( enabled ) =>
												updateExperiment(
													experiment.id,
													enabled
												)
											}
										/>
									</div>
								) ) }
							</div>
						</section>
				  ) )
				: null }
		</div>
	);
}
