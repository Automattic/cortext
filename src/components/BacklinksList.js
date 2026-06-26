import { Button } from '@wordpress/components';

import { useCurrentViewMode } from './CurrentViewModeContext';
import { useDocumentPeekActions } from './DocumentPeekProvider';
import { documentTitle, listIconForRecord } from '../documents';
import './BacklinksPanel.scss';

// Shared list of backlink sources. Each row shows the source's icon and title,
// with a muted breadcrumb of the collection it lives in when there is one.
// Opening a source reuses the peek (replacing its content) rather than routing
// underneath an open modal.
export default function BacklinksList( { sources, onNavigate } ) {
	const { openDocument } = useDocumentPeekActions();
	const currentViewMode = useCurrentViewMode();
	return (
		<ul className="cortext-backlinks__list">
			{ sources.map( ( source ) => (
				<li className="cortext-backlinks__item" key={ source.id }>
					<Button
						className="cortext-backlinks__button"
						variant="tertiary"
						onClick={ () => {
							openDocument( {
								id: source.id,
								postType: 'crtxt_document',
								collectionId: source.collection?.id ?? null,
								preferredMode: currentViewMode,
							} );
							onNavigate?.();
						} }
					>
						<span
							className="cortext-backlinks__icon"
							aria-hidden="true"
						>
							{ listIconForRecord( source, 16 ) }
						</span>
						<span className="cortext-backlinks__label">
							<span className="cortext-backlinks__heading">
								<span className="cortext-backlinks__title">
									{ documentTitle( source ) }
								</span>
								{ source.mentions > 1 ? (
									<span className="cortext-backlinks__count">
										{ `(${ source.mentions })` }
									</span>
								) : null }
							</span>
							{ source.collection?.title ? (
								<span className="cortext-backlinks__crumb">
									{ source.collection.title }
								</span>
							) : null }
						</span>
					</Button>
				</li>
			) ) }
		</ul>
	);
}
