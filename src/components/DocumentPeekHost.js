import { __ } from '@wordpress/i18n';
import { useMemo } from '@wordpress/element';

import RowDetailView from './RowDetailView';
import { RowDetailSidebar } from './RowDetailSidebarSlot';
import { CurrentViewModeProvider } from './CurrentViewModeContext';
import {
	useDocumentPeekActions,
	useDocumentPeekState,
	useDocumentPeekSurface,
} from './DocumentPeekProvider';
import useCollectionFields from '../hooks/useCollectionFields';
import { adjacentRowId } from './rowDetailUtils';

// EntityRoute adds this title field for full-page rows. Do the same here so
// RowProperties and RowDetailView get the same field shape.
function withTitleField( fields ) {
	return [
		{
			id: 'title',
			label: __( 'Title', 'cortext' ),
			cortextType: 'title',
			editable: true,
			getValue: ( { item } ) =>
				item?.title?.raw ?? item?.title?.rendered ?? '',
		},
		...fields,
	];
}

// Render the active peek: side panel through SlotFill, modal inline at app
// root. Keeping this separate stops relation chips and collection cells from
// importing RowDetailView and the editor stack.
export default function DocumentPeekHost() {
	const { peek } = useDocumentPeekState();
	const { closeDocument, requestMode } = useDocumentPeekActions();
	const {
		modeSurfaceTransition,
		saveError,
		setDetailApi,
		goToAdjacentDocument,
		retryPendingTransition,
		discardPendingTransition,
	} = useDocumentPeekSurface();
	const { fields: collectionFields } = useCollectionFields(
		peek?.collectionId ?? null
	);
	const peekFields = useMemo( () => {
		if ( ! peek || ! collectionFields ) {
			return undefined;
		}
		return withTitleField( collectionFields );
	}, [ peek, collectionFields ] );

	const renderedMode = modeSurfaceTransition
		? modeSurfaceTransition.surfaceMode
		: peek?.mode;

	if ( ! peek || ! peekFields || ! renderedMode ) {
		return null;
	}

	const rowList = peek.source?.getRowList?.() ?? [];
	const canGoNext = Boolean(
		peek.source && adjacentRowId( rowList, peek.docId, 1 )
	);
	const canGoPrevious = Boolean(
		peek.source && adjacentRowId( rowList, peek.docId, -1 )
	);
	// Show the row from the table immediately so the panel can paint title
	// and icon before useEntityRecord resolves. RowDetailView prefers `record`
	// once it arrives, so this is only used by LoadingDetail.
	const tentativeRow = rowList.find(
		( candidate ) => String( candidate?.id ) === String( peek.docId )
	);
	const handleSaved = () => peek.source?.refresh?.();
	const handleRestored = () => peek.source?.refresh?.();

	const detailView = (
		<CurrentViewModeProvider value={ peek.mode }>
			<RowDetailView
				canGoNext={ canGoNext }
				canGoPrevious={ canGoPrevious }
				collectionId={ peek.collectionId }
				fields={ peekFields }
				mode={ renderedMode }
				onApi={ setDetailApi }
				onClose={ closeDocument }
				onDiscardPending={ discardPendingTransition }
				onModeChange={ requestMode }
				onNext={ () => goToAdjacentDocument( 1 ) }
				onPrevious={ () => goToAdjacentDocument( -1 ) }
				onRestored={ handleRestored }
				onRetryPending={ retryPendingTransition }
				onSaved={ handleSaved }
				postType={ peek.postType }
				row={ tentativeRow }
				rowId={ peek.docId }
				saveError={ saveError }
			/>
		</CurrentViewModeProvider>
	);

	return renderedMode === 'side' ? (
		<RowDetailSidebar.Fill>{ detailView }</RowDetailSidebar.Fill>
	) : (
		detailView
	);
}
