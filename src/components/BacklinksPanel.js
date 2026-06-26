import apiFetch from '@wordpress/api-fetch';
import { Button } from '@wordpress/components';
import { useEffect, useState } from '@wordpress/element';
import { _n, sprintf } from '@wordpress/i18n';
import { chevronDown, chevronRight } from '@wordpress/icons';
import { useNavigate } from '@tanstack/react-router';

import { documentTitle, listIconForRecord } from '../documents';
import './BacklinksPanel.scss';

function uniqueSources( sources ) {
	const seen = new Set();
	return sources.filter( ( source ) => {
		if ( ! source?.id || seen.has( source.id ) ) {
			return false;
		}
		seen.add( source.id );
		return true;
	} );
}

function sourcesFromResponse( data ) {
	if ( Array.isArray( data?.sources ) ) {
		return uniqueSources( data.sources );
	}
	if ( ! Array.isArray( data?.groups ) ) {
		return [];
	}
	return uniqueSources(
		data.groups.flatMap( ( group ) =>
			Array.isArray( group?.sources ) ? group.sources : []
		)
	);
}

function BacklinksList( { sources } ) {
	const navigate = useNavigate();
	return (
		<div className="cortext-backlinks">
			<ul className="cortext-backlinks__list">
				{ sources.map( ( source ) => (
					<li className="cortext-backlinks__item" key={ source.id }>
						<Button
							className="cortext-backlinks__button"
							variant="tertiary"
							onClick={ () => {
								if ( source.path ) {
									navigate( {
										to: '/$',
										params: {
											_splat: source.path,
										},
									} );
								}
							} }
						>
							<span
								className="cortext-backlinks__icon"
								aria-hidden="true"
							>
								{ listIconForRecord( source, 16 ) }
							</span>
							<span className="cortext-backlinks__title">
								{ documentTitle( source ) }
							</span>
						</Button>
					</li>
				) ) }
			</ul>
		</div>
	);
}

// Backlinks stay collapsed by default to a single quiet line, in the spirit of
// Notion's linked-references; expanding reveals the source list inline.
export default function BacklinksPanel( {
	className = '',
	documentId,
	initialOpen = false,
} ) {
	const [ data, setData ] = useState( null );
	const [ isOpen, setIsOpen ] = useState( initialOpen );

	useEffect( () => {
		if ( ! documentId ) {
			setData( null );
			return undefined;
		}

		let cancelled = false;
		apiFetch( {
			path: `/cortext/v1/documents/${ documentId }/backlinks`,
		} )
			.then( ( response ) => {
				if ( ! cancelled ) {
					setData( response );
				}
			} )
			.catch( () => {
				if ( ! cancelled ) {
					setData( null );
				}
			} );

		return () => {
			cancelled = true;
		};
	}, [ documentId ] );

	const sources = sourcesFromResponse( data );
	const total = sources.length;
	if ( total < 1 ) {
		return null;
	}

	const label = sprintf(
		/* translators: %d: backlink count. */
		_n( 'Backlink (%d)', 'Backlinks (%d)', total, 'cortext' ),
		total
	);

	return (
		<div className={ `cortext-backlinks-panel ${ className }`.trim() }>
			<Button
				className="cortext-backlinks-panel__toggle"
				icon={ isOpen ? chevronDown : chevronRight }
				onClick={ () => setIsOpen( ( value ) => ! value ) }
				aria-expanded={ isOpen }
			>
				{ label }
			</Button>
			{ isOpen ? <BacklinksList sources={ sources } /> : null }
		</div>
	);
}
