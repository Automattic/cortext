import { useCallback, useEffect, useMemo, useState } from '@wordpress/element';
import { useDispatch } from '@wordpress/data';

import {
	createTemplate,
	createTemplateFromDocument,
	duplicateTemplate,
	fetchDefaultPageTemplate,
	fetchTemplates,
	instantiateTemplate,
	setDefaultPageTemplate,
} from './actions';
import {
	afterDocumentTrash,
	applyInvalidationPack,
} from '../documents/invalidation';

const TEMPLATES_CHANGED_EVENT = 'cortext:templates-changed';

export function notifyTemplatesChanged( detail = {} ) {
	if ( typeof window === 'undefined' ) {
		return;
	}
	window.dispatchEvent(
		new window.CustomEvent( TEMPLATES_CHANGED_EVENT, { detail } )
	);
}

function matchesTemplateChange( detail, kind, collectionId ) {
	if ( detail?.kind && detail.kind !== kind ) {
		return false;
	}
	if (
		detail?.collectionId &&
		Number( detail.collectionId ) !== Number( collectionId )
	) {
		return false;
	}
	return true;
}

export function useTemplates( { kind, collectionId, enabled = true } = {} ) {
	const [ templates, setTemplates ] = useState( [] );
	const [ isResolving, setIsResolving ] = useState( enabled );
	const [ error, setError ] = useState( null );

	const refresh = useCallback( async () => {
		if ( ! enabled ) {
			setTemplates( [] );
			setIsResolving( false );
			setError( null );
			return [];
		}
		setIsResolving( true );
		setError( null );
		try {
			const next = await fetchTemplates( { kind, collectionId } );
			setTemplates( next );
			return next;
		} catch ( nextError ) {
			setTemplates( [] );
			setError( nextError );
			return [];
		} finally {
			setIsResolving( false );
		}
	}, [ kind, collectionId, enabled ] );

	useEffect( () => {
		if ( ! enabled ) {
			setTemplates( [] );
			setIsResolving( false );
			setError( null );
			return undefined;
		}

		let cancelled = false;
		setIsResolving( true );
		setError( null );
		fetchTemplates( { kind, collectionId } )
			.then( ( next ) => {
				if ( ! cancelled ) {
					setTemplates( next );
					setIsResolving( false );
				}
			} )
			.catch( ( nextError ) => {
				if ( ! cancelled ) {
					setTemplates( [] );
					setError( nextError );
					setIsResolving( false );
				}
			} );
		return () => {
			cancelled = true;
		};
	}, [ kind, collectionId, enabled ] );

	useEffect( () => {
		if ( ! enabled || typeof window === 'undefined' ) {
			return undefined;
		}
		const onTemplatesChanged = ( event ) => {
			if ( matchesTemplateChange( event.detail, kind, collectionId ) ) {
				refresh();
			}
		};
		window.addEventListener( TEMPLATES_CHANGED_EVENT, onTemplatesChanged );
		return () =>
			window.removeEventListener(
				TEMPLATES_CHANGED_EVENT,
				onTemplatesChanged
			);
	}, [ collectionId, enabled, kind, refresh ] );

	return useMemo(
		() => ( { templates, isResolving, error, refresh } ),
		[ templates, isResolving, error, refresh ]
	);
}

export function useDefaultPageTemplate() {
	const [ template, setTemplate ] = useState( null );
	const [ isResolving, setIsResolving ] = useState( true );
	const [ error, setError ] = useState( null );

	const refresh = useCallback( async () => {
		setIsResolving( true );
		setError( null );
		try {
			const next = await fetchDefaultPageTemplate();
			setTemplate( next );
			return next;
		} catch ( nextError ) {
			setTemplate( null );
			setError( nextError );
			return null;
		} finally {
			setIsResolving( false );
		}
	}, [] );

	useEffect( () => {
		refresh();
	}, [ refresh ] );

	const setDefault = useCallback( async ( id ) => {
		const next = await setDefaultPageTemplate( id );
		setTemplate( next );
		return next;
	}, [] );

	return useMemo(
		() => ( { template, isResolving, error, refresh, setDefault } ),
		[ template, isResolving, error, refresh, setDefault ]
	);
}

export function useCreateTemplate() {
	return useCallback( async ( data = {} ) => createTemplate( data ), [] );
}

export function useCreateTemplateFromDocument() {
	return useCallback(
		async ( documentId ) => createTemplateFromDocument( documentId ),
		[]
	);
}

export function useDuplicateTemplate() {
	return useCallback( async ( id ) => duplicateTemplate( id ), [] );
}

export function useInstantiateTemplate() {
	const { invalidateResolution } = useDispatch( 'core' );
	return useCallback(
		async ( id, data = {} ) => {
			const created = await instantiateTemplate( id, data );
			if ( created?.id ) {
				applyInvalidationPack(
					invalidateResolution,
					afterDocumentTrash
				);
			}
			return created;
		},
		[ invalidateResolution ]
	);
}
