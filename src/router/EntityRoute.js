import { useParams } from '@tanstack/react-router';
import { Spinner } from '@wordpress/components';
import { __ } from '@wordpress/i18n';

import Canvas from '../components/Canvas';
import { useResolveEntity } from './useResolveEntity';

export default function EntityRoute() {
	const params = useParams( { strict: false } );
	const { entity, isResolving, notFound } = useResolveEntity(
		params._splat ?? ''
	);

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
