import { useParams } from '@tanstack/react-router';
import { Spinner } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { useState } from '@wordpress/element';

import Canvas from '../components/Canvas';
import CollectionDataViews from '../components/CollectionDataViews';
import {
	parseIdFromUri,
	parseSplatUri,
	useResolveEntity,
	useResolveCollection,
} from './useResolveEntity';

function PageRoute( { uri } ) {
	const { entity, isResolving, notFound } = useResolveEntity( uri );

	if ( isResolving ) {
		return (
			<div className="cortext-canvas__loading">
				<Spinner />
			</div>
		);
	}

	if ( notFound || ! entity ) {
		return (
			<div className="cortext-canvas__empty">
				<p>{ __( "That page doesn't exist.", 'cortext' ) }</p>
			</div>
		);
	}

	return <Canvas postId={ entity.id } key={ entity.id } />;
}

const DEFAULT_VIEW = {
	type: 'table',
	fields: [],
	sort: null,
	filters: [],
	perPage: 25,
	page: 1,
	search: '',
	layout: {},
};

function CollectionView( { collectionId } ) {
	const [ view, setView ] = useState( DEFAULT_VIEW );

	return (
		<CollectionDataViews
			collectionId={ collectionId }
			view={ view }
			onChangeView={ setView }
			loading={
				<div className="cortext-canvas__loading">
					<Spinner />
				</div>
			}
			empty={
				<p className="cortext-canvas__empty-text">
					{ __( 'No entries yet.', 'cortext' ) }
				</p>
			}
		/>
	);
}

function CollectionRoute( { uri } ) {
	const id = parseIdFromUri( uri );
	const { entity, isResolving, notFound } = useResolveCollection( id );

	if ( isResolving ) {
		return (
			<div className="cortext-canvas__loading">
				<Spinner />
			</div>
		);
	}

	if ( notFound || ! entity ) {
		return (
			<div className="cortext-canvas__empty">
				<p>{ __( "That collection doesn't exist.", 'cortext' ) }</p>
			</div>
		);
	}

	return (
		<div className="cortext-canvas__table">
			<CollectionView collectionId={ entity.id } key={ entity.id } />
		</div>
	);
}

export default function EntityRoute() {
	const params = useParams( { strict: false } );
	const { prefix, tail } = parseSplatUri( params._splat ?? '' );

	if ( prefix === 'collection' ) {
		return <CollectionRoute uri={ tail } key={ `c-${ tail }` } />;
	}

	return <PageRoute uri={ tail } />;
}
