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

export default function ExperimentsPane() {
	const [ state, setState ] = useState( {
		canManage: false,
		experiments: [],
		isLoading: true,
		error: null,
	} );
	const [ isSaving, setIsSaving ] = useState( false );
	const isSavingRef = useRef( false );
	const { createErrorNotice, createSuccessNotice } =
		useDispatch( noticesStore );

	useEffect( () => {
		let cancelled = false;
		apiFetch( { path: '/cortext/v1/experiments' } )
			.then( ( response ) => {
				if ( cancelled ) {
					return;
				}
				setState( {
					canManage: response?.canManage === true,
					experiments: Array.isArray( response?.experiments )
						? response.experiments
						: [],
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

	const updateExperiment = useCallback(
		( id, enabled ) => {
			if ( isSavingRef.current ) {
				return;
			}

			const previousEnabled =
				state.experiments.find( ( experiment ) => experiment.id === id )
					?.enabled === true;
			isSavingRef.current = true;
			setIsSaving( true );
			setState( ( current ) => ( {
				...current,
				experiments: current.experiments.map( ( experiment ) =>
					experiment.id === id
						? { ...experiment, enabled }
						: experiment
				),
			} ) );
			apiFetch( {
				path: '/cortext/v1/experiments',
				method: 'PUT',
				data: { enabled: { [ id ]: enabled } },
			} )
				.then( ( response ) => {
					const experiments = Array.isArray( response?.experiments )
						? response.experiments
						: null;
					if ( experiments ) {
						syncCortextExperiments( experiments );
					}
					setState( ( current ) => ( {
						...current,
						canManage: response?.canManage === true,
						experiments: experiments ?? current.experiments,
						error: null,
					} ) );
					createSuccessNotice(
						__( 'Experiment updated.', 'cortext' ),
						{
							id: 'cortext-experiments-updated',
							type: 'snackbar',
						}
					);
				} )
				.catch( () => {
					setState( ( current ) => ( {
						...current,
						experiments: current.experiments.map( ( experiment ) =>
							experiment.id === id
								? {
										...experiment,
										enabled: previousEnabled,
								  }
								: experiment
						),
					} ) );
					createErrorNotice(
						__( "Couldn't update this experiment.", 'cortext' ),
						{
							id: 'cortext-experiments-update-failed',
							type: 'snackbar',
						}
					);
				} )
				.finally( () => {
					isSavingRef.current = false;
					setIsSaving( false );
				} );
		},
		[ createErrorNotice, createSuccessNotice, state.experiments ]
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
											disabled={ isSaving }
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
