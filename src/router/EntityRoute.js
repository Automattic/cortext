import { useParams } from '@tanstack/react-router';
import { Spinner } from '@wordpress/components';
import { __ } from '@wordpress/i18n';

import Canvas from '../components/Canvas';
import CollectionTable from '../components/CollectionTable';
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
			<CollectionTable slug={ entity.slug } key={ entity.id } />
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
