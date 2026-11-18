import { __ } from '@wordpress/i18n';
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from '@wordpress/element';
import { useParams } from '@tanstack/react-router';

import RowDetailView from './RowDetailView';
import { RowDetailSidebar } from './RowDetailSidebarSlot';
import { CurrentViewModeProvider } from './CurrentViewModeContext';
import {
	useDocumentPeekActions,
	useDocumentPeekState,
	useDocumentPeekSurface,
} from './DocumentPeekProvider';
import { elementsFromOptions } from '../hooks/optionElements';
import useCollectionFields from '../hooks/useCollectionFields';
import { adjacentRowId } from './rowDetailUtils';
import { parseIdFromUri } from '../router/useResolveEntity';

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
	const { peek, isPinned } = useDocumentPeekState();
	const { closeDocument, requestMode } = useDocumentPeekActions();
	const {
		modeSurfaceTransition,
		saveError,
		setDetailApi,
		goToAdjacentDocument,
		retryPendingTransition,
		discardPendingTransition,
		togglePin,
	} = useDocumentPeekSurface();

	// Side peeks close on route change unless pinned. Modal mode floats over
	// the route, so it doesn't need the same gate.
	const params = useParams( { strict: false } );
	const splat = params?._splat ?? '';
	const routeDocId = parseIdFromUri( splat );
	const prevSplatRef = useRef( splat );
	const peekStateRef = useRef( { peek, isPinned } );
	peekStateRef.current = { peek, isPinned };
	const [ optionOverrides, setOptionOverrides ] = useState( {} );
	const [ formatOverrides, setFormatOverrides ] = useState( {} );
	const [ , setRowListRevision ] = useState( 0 );

	useEffect( () => {
		setOptionOverrides( {} );
		setFormatOverrides( {} );
	}, [ peek?.collectionId ] );

	const updateFieldOptions = useCallback( ( recordId, nextOptions ) => {
		const fieldId = `field-${ recordId }`;
		const elements = elementsFromOptions( nextOptions ) || [];
		setOptionOverrides( ( current ) => ( {
			...current,
			[ fieldId ]: elements,
		} ) );
		peekStateRef.current.peek?.source?.updateFieldOptions?.(
			recordId,
			nextOptions
		);
	}, [] );
	const updateFieldFormat = useCallback( ( recordId, nextFormat ) => {
		const fieldId = `field-${ recordId }`;
		setFormatOverrides( ( current ) => ( {
			...current,
			[ fieldId ]: nextFormat ?? null,
		} ) );
		peekStateRef.current.peek?.source?.updateFieldFormat?.(
			recordId,
			nextFormat
		);
	}, [] );
	const refreshRows = useCallback( () => {
		peekStateRef.current.peek?.source?.refresh?.();
	}, [] );
	const mutationContext = useMemo(
		() => ( {
			optionOverrides,
			updateFieldOptions,
			formatOverrides,
			updateFieldFormat,
			refreshRows,
		} ),
		[
			optionOverrides,
			updateFieldOptions,
			formatOverrides,
			updateFieldFormat,
			refreshRows,
		]
	);
	useEffect( () => {
		const prev = prevSplatRef.current;
		prevSplatRef.current = splat;
		if ( prev === splat ) {
			return;
		}
		const current = peekStateRef.current;
		if ( ! current.peek || current.peek.mode !== 'side' ) {
			return;
		}
		if ( current.isPinned ) {
			return;
		}
		closeDocument();
	}, [ splat, closeDocument ] );

	const {
		detailFields: collectionDetailFields,
		allDetailFields: collectionAllDetailFields,
		detailLayoutEntries,
	} = useCollectionFields( peek?.collectionId ?? null );
	const peekFields = useMemo( () => {
		if ( ! peek || ! collectionDetailFields ) {
			return undefined;
		}
		return withTitleField( collectionDetailFields );
	}, [ peek, collectionDetailFields ] );
	const peekAllFields = useMemo( () => {
		if ( ! peek || ! collectionAllDetailFields ) {
			return undefined;
		}
		return withTitleField( collectionAllDetailFields );
	}, [ peek, collectionAllDetailFields ] );

	const renderedMode = modeSurfaceTransition
		? modeSurfaceTransition.surfaceMode
		: peek?.mode;

	useEffect( () => {
		return peek?.source?.subscribeToRowList?.( () => {
			setRowListRevision( ( current ) => current + 1 );
		} );
	}, [ peek?.source ] );

	// Opening the doc that is already the background route would mount a second
	// editor for the same post and loop. Treat it as "go back": close the
	// redundant peek instead of rendering it.
	const isCircular =
		!! peek &&
		routeDocId !== null &&
		String( peek.docId ) === String( routeDocId );
	useEffect( () => {
		if ( isCircular ) {
			closeDocument();
		}
	}, [ isCircular, closeDocument ] );

	if ( ! peek || ! peekFields || ! renderedMode || isCircular ) {
		return null;
	}

	const rowList = peek.source?.getRowList?.() ?? [];
	const canGoNext = Boolean(
		peek.source && adjacentRowId( rowList, peek.docId, 1 )
	);
	const canGoPrevious = Boolean(
		peek.source && adjacentRowId( rowList, peek.docId, -1 )
	);
	// Use the current table row as a stopgap while useEntityRecord catches up.
	// The loading pane can show a title and icon instead of opening blank.
	const tentativeRow = rowList.find(
		( candidate ) => String( candidate?.id ) === String( peek.docId )
	);
	const handleSaved = () => peek.source?.refresh?.();
	const handleRestored = () => peek.source?.refresh?.();

	const detailView = (
		<CurrentViewModeProvider value={ peek.mode }>
			<RowDetailView
				allFields={ peekAllFields }
				canGoNext={ canGoNext }
				canGoPrevious={ canGoPrevious }
				collectionId={ peek.collectionId }
				detailLayoutEntries={ detailLayoutEntries }
				fields={ peekFields }
				isPinned={ isPinned }
				mode={ renderedMode }
				mutationContext={ mutationContext }
				onApi={ setDetailApi }
				onClose={ closeDocument }
				onDiscardPending={ discardPendingTransition }
				onModeChange={ requestMode }
				onNext={ () => goToAdjacentDocument( 1 ) }
				onPrevious={ () => goToAdjacentDocument( -1 ) }
				onRestored={ handleRestored }
				onRetryPending={ retryPendingTransition }
				onSaved={ handleSaved }
				onTogglePin={ togglePin }
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
