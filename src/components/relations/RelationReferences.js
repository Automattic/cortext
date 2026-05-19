import { __, _n, sprintf } from '@wordpress/i18n';
import { Icon, arrowUpRight } from '@wordpress/icons';

import { relationTitle, rowHref, shouldUseNativeLink } from './relationUtils';
import { useDocumentPeekActions } from '../DocumentPeekProvider';
import { useCurrentViewMode } from '../CurrentViewModeContext';

export default function RelationReferences( { value } ) {
	const { openDocument } = useDocumentPeekActions();
	const currentViewMode = useCurrentViewMode();
	const refs = Array.isArray( value ) ? value : [ value ];
	const populated = refs.filter( ( ref ) => ref && ref.id );
	if ( populated.length === 0 ) {
		return '';
	}
	const overflowCount = Math.max( 0, populated.length - 2 );
	return (
		<span className="cortext-relation-refs">
			{ populated.map( ( ref ) => {
				const title = relationTitle( ref );
				return (
					<a
						key={ ref.id }
						className="cortext-relation-ref"
						href={ rowHref( ref ) }
						target="_top"
						onClick={ ( event ) => {
							event.stopPropagation();
							if ( shouldUseNativeLink( event ) ) {
								return;
							}
							event.preventDefault();
							openDocument( {
								id: ref.id,
								slug: ref.slug ?? '',
								postType: ref.collectionSlug
									? `crtxt_${ ref.collectionSlug }`
									: null,
								collectionId: ref.collectionId,
								preferredMode: currentViewMode,
							} );
						} }
					>
						<Icon
							className="cortext-relation-ref__icon"
							icon={ arrowUpRight }
						/>
						<span className="cortext-relation-ref__title">
							{ title }
						</span>
					</a>
				);
			} ) }
			{ overflowCount > 0 ? (
				<span
					className="cortext-relation-ref-more"
					aria-label={ sprintf(
						/* translators: %d: number of hidden relation references */
						_n(
							'%d more relation',
							'%d more relations',
							overflowCount,
							'cortext'
						),
						overflowCount
					) }
				>
					{ sprintf(
						/* translators: %d: number of hidden relation references */
						__( '+%d', 'cortext' ),
						overflowCount
					) }
				</span>
			) : null }
		</span>
	);
}
