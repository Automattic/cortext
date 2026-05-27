import { __ } from '@wordpress/i18n';
import { Button, Notice } from '@wordpress/components';
import { useMemo, useRef, useState } from '@wordpress/element';
import { seen as seenIcon, unseen as unseenIcon } from '@wordpress/icons';

import './FormulaConfig.scss';

import { useCollectionFieldsContext } from '../CollectionFieldsContext';

const SYSTEM_FIELDS = [
	{ label: 'Title', type: 'text' },
	{ label: 'Created', type: 'datetime' },
	{ label: 'Last edited', type: 'datetime' },
];

const UNSUPPORTED_FIELD_REF_TYPES = new Set( [
	'multiselect',
	'relation',
	'rollup',
] );

const OPERATORS = [ '+', '-', '*', '/', '=', '!=', '>', '<', '>=', '<=' ];
const AUTOCOMPLETE_CONTROL_KEYS = new Set( [
	'ArrowDown',
	'ArrowUp',
	'Enter',
	'Tab',
	'Escape',
] );
const FUNCTIONS = [
	'concat()',
	'length()',
	'upper()',
	'lower()',
	'contains()',
	'if()',
	'now()',
	'dateBetween()',
	'formatDate()',
];

const FUNCTION_COMPLETIONS = [
	{
		label: 'field',
		signature: 'field("Name")',
		insertText: 'field("")',
		caretOffset: 'field("'.length,
		type: 'field',
		description: __( 'Use a value from this row.', 'cortext' ),
	},
	{
		label: 'prop',
		signature: 'prop("Name")',
		insertText: 'prop("")',
		caretOffset: 'prop("'.length,
		type: 'alias',
		description: __( 'Works the same as field().', 'cortext' ),
	},
	{
		label: 'concat',
		signature: 'concat(value, ...)',
		insertText: 'concat()',
		caretOffset: 'concat('.length,
		type: 'text',
		description: __( 'Join values.', 'cortext' ),
	},
	{
		label: 'length',
		signature: 'length(text)',
		insertText: 'length()',
		caretOffset: 'length('.length,
		type: 'number',
		description: __( 'Count characters.', 'cortext' ),
	},
	{
		label: 'upper',
		signature: 'upper(text)',
		insertText: 'upper()',
		caretOffset: 'upper('.length,
		type: 'text',
		description: __( 'Make text uppercase.', 'cortext' ),
	},
	{
		label: 'lower',
		signature: 'lower(text)',
		insertText: 'lower()',
		caretOffset: 'lower('.length,
		type: 'text',
		description: __( 'Make text lowercase.', 'cortext' ),
	},
	{
		label: 'contains',
		signature: 'contains(text, search)',
		insertText: 'contains(, )',
		caretOffset: 'contains('.length,
		type: 'checkbox',
		description: __( 'Check whether text contains a match.', 'cortext' ),
	},
	{
		label: 'if',
		signature: 'if(condition, then, else)',
		insertText: 'if(, , )',
		caretOffset: 'if('.length,
		type: 'same type',
		description: __( 'Choose one of two values.', 'cortext' ),
	},
	{
		label: 'now',
		signature: 'now()',
		insertText: 'now()',
		caretOffset: 'now()'.length,
		type: 'datetime',
		description: __( 'Current date and time.', 'cortext' ),
	},
	{
		label: 'dateBetween',
		signature: 'dateBetween(a, b, "days")',
		insertText: 'dateBetween(, , "days")',
		caretOffset: 'dateBetween('.length,
		type: 'number',
		description: __( 'Difference between two dates.', 'cortext' ),
	},
	{
		label: 'formatDate',
		signature: 'formatDate(date, format)',
		insertText: 'formatDate(, "YYYY-MM-DD")',
		caretOffset: 'formatDate('.length,
		type: 'text',
		description: __( 'Format a date as text.', 'cortext' ),
	},
];

const HIGHLIGHT_FUNCTIONS = new Set( [
	'field',
	'prop',
	'concat',
	'length',
	'upper',
	'lower',
	'contains',
	'if',
	'now',
	'datebetween',
	'formatdate',
] );

function isNameStart( char ) {
	return /[A-Za-z_]/.test( char );
}

function isNamePart( char ) {
	return /[A-Za-z0-9_]/.test( char );
}

function formulaTokens( value ) {
	const tokens = [];
	let index = 0;

	while ( index < value.length ) {
		const char = value[ index ];
		const next = value[ index + 1 ] ?? '';

		if ( /\s/.test( char ) ) {
			const start = index;
			while ( index < value.length && /\s/.test( value[ index ] ) ) {
				index += 1;
			}
			tokens.push( { text: value.slice( start, index ), type: 'plain' } );
			continue;
		}

		if ( char === '"' ) {
			const start = index;
			index += 1;
			while ( index < value.length ) {
				if ( value[ index ] === '\\' ) {
					index += 2;
					continue;
				}
				if ( value[ index ] === '"' ) {
					index += 1;
					break;
				}
				index += 1;
			}
			tokens.push( {
				text: value.slice( start, index ),
				type: /(?:field|prop)\s*\(\s*$/i.test( value.slice( 0, start ) )
					? 'field'
					: 'string',
			} );
			continue;
		}

		if ( /\d/.test( char ) || ( char === '.' && /\d/.test( next ) ) ) {
			const start = index;
			let hasDot = false;
			while ( index < value.length ) {
				const current = value[ index ];
				if ( current === '.' ) {
					if ( hasDot ) {
						break;
					}
					hasDot = true;
					index += 1;
					continue;
				}
				if ( ! /\d/.test( current ) ) {
					break;
				}
				index += 1;
			}
			tokens.push( {
				text: value.slice( start, index ),
				type: 'number',
			} );
			continue;
		}

		if ( isNameStart( char ) ) {
			const start = index;
			index += 1;
			while ( index < value.length && isNamePart( value[ index ] ) ) {
				index += 1;
			}
			const text = value.slice( start, index );
			const lower = text.toLowerCase();
			let lookahead = index;
			while ( /\s/.test( value[ lookahead ] ?? '' ) ) {
				lookahead += 1;
			}
			const isFunction =
				value[ lookahead ] === '(' && HIGHLIGHT_FUNCTIONS.has( lower );
			let type = 'unknown';
			if ( lower === 'true' || lower === 'false' ) {
				type = 'boolean';
			} else if ( isFunction ) {
				type = 'function';
			}
			tokens.push( { text, type } );
			continue;
		}

		const two = char + next;
		if ( [ '==', '!=', '>=', '<=' ].includes( two ) ) {
			tokens.push( { text: two, type: 'operator' } );
			index += 2;
			continue;
		}

		if ( [ '+', '-', '*', '/', '=', '>', '<' ].includes( char ) ) {
			tokens.push( { text: char, type: 'operator' } );
			index += 1;
			continue;
		}

		if ( [ '(', ')', ',' ].includes( char ) ) {
			tokens.push( { text: char, type: 'punctuation' } );
			index += 1;
			continue;
		}

		tokens.push( { text: char, type: 'unknown' } );
		index += 1;
	}

	if ( value.endsWith( '\n' ) ) {
		tokens.push( { text: ' ', type: 'plain' } );
	}

	return tokens;
}

function isInsideString( value, caret ) {
	let inString = false;
	for ( let index = 0; index < caret; index += 1 ) {
		const char = value[ index ];
		if ( char === '\\' ) {
			index += 1;
			continue;
		}
		if ( char === '"' ) {
			inString = ! inString;
		}
	}
	return inString;
}

function formulaAutocomplete( value, caret ) {
	const before = value.slice( 0, caret );
	const fieldMatch = before.match( /(?:field|prop)\s*\(\s*"([^"]*)$/i );
	if ( fieldMatch ) {
		return {
			kind: 'field',
			start: caret - fieldMatch[ 1 ].length,
			end: caret,
			query: fieldMatch[ 1 ],
		};
	}

	if ( isInsideString( value, caret ) ) {
		return null;
	}

	const functionMatch = before.match(
		/(^|[^A-Za-z0-9_])([A-Za-z_][A-Za-z0-9_]*)$/
	);
	if ( ! functionMatch ) {
		return null;
	}

	return {
		kind: 'function',
		start: caret - functionMatch[ 2 ].length,
		end: caret,
		query: functionMatch[ 2 ],
	};
}

function escapePropName( name ) {
	return name.replaceAll( '\\', '\\\\' ).replaceAll( '"', '\\"' );
}

function uniqueProperties( fields, excludeRecordId ) {
	const options = [ ...SYSTEM_FIELDS ];
	const seen = new Set( options.map( ( option ) => option.label ) );
	fields.forEach( ( field ) => {
		if (
			field.recordId === excludeRecordId ||
			! field.label ||
			UNSUPPORTED_FIELD_REF_TYPES.has( field.cortextType )
		) {
			return;
		}
		if ( seen.has( field.label ) ) {
			return;
		}
		seen.add( field.label );
		options.push( {
			label: field.label,
			type: field.formulaResultType ?? field.cortextType ?? 'text',
		} );
	} );
	return options;
}

export default function FormulaConfig( {
	initialExpression = '',
	isBusy = false,
	onBack,
	onError,
	onSubmit,
	errorMessage = '',
	submitLabel = __( 'Create formula', 'cortext' ),
	backLabel = __( 'Back', 'cortext' ),
	excludeRecordId,
} ) {
	const textareaRef = useRef( null );
	const editorId = useRef(
		`cortext-formula-expression-${ Math.random()
			.toString( 36 )
			.slice( 2 ) }`
	);
	const { fields } = useCollectionFieldsContext();
	const [ expression, setExpression ] = useState( initialExpression );
	const [ activeMatch, setActiveMatch ] = useState( null );
	const [ activeIndex, setActiveIndex ] = useState( 0 );
	const [ editorScroll, setEditorScroll ] = useState( {
		left: 0,
		top: 0,
	} );
	const [ isReferenceOpen, setIsReferenceOpen ] = useState( false );

	const properties = useMemo(
		() => uniqueProperties( fields, excludeRecordId ),
		[ fields, excludeRecordId ]
	);
	const highlightedTokens = useMemo(
		() => formulaTokens( expression ),
		[ expression ]
	);
	const suggestions = useMemo( () => {
		if ( ! activeMatch ) {
			return [];
		}
		const needle = activeMatch.query.toLowerCase();
		if ( activeMatch.kind === 'function' ) {
			return FUNCTION_COMPLETIONS.filter( ( completion ) =>
				`${ completion.label } ${ completion.signature }`
					.toLowerCase()
					.includes( needle )
			)
				.slice( 0, 8 )
				.map( ( completion ) => ( {
					...completion,
					kind: 'function',
				} ) );
		}
		return properties
			.filter( ( property ) =>
				property.label.toLowerCase().includes( needle )
			)
			.slice( 0, 8 )
			.map( ( property ) => ( {
				...property,
				kind: 'field',
			} ) );
	}, [ activeMatch, properties ] );

	const syncAutocomplete = ( nextValue, nextCaret ) => {
		const match = formulaAutocomplete( nextValue, nextCaret );
		setActiveMatch( match );
		setActiveIndex( 0 );
	};

	const selectSuggestion = ( suggestion ) => {
		if ( ! activeMatch || ! suggestion ) {
			return;
		}

		let insertText;
		let nextCaret;
		if ( suggestion.kind === 'function' ) {
			insertText = suggestion.insertText;
			nextCaret = activeMatch.start + suggestion.caretOffset;
		} else {
			const escaped = escapePropName( suggestion.label );
			const hasClosingSuffix = expression
				.slice( activeMatch.end )
				.startsWith( '")' );
			const suffix = hasClosingSuffix ? '' : '")';
			insertText = escaped + suffix;
			nextCaret =
				activeMatch.start +
				escaped.length +
				( hasClosingSuffix ? 2 : suffix.length );
		}

		const next =
			expression.slice( 0, activeMatch.start ) +
			insertText +
			expression.slice( activeMatch.end );
		setExpression( next );
		syncAutocomplete( next, nextCaret );
		window.requestAnimationFrame( () => {
			textareaRef.current?.setSelectionRange( nextCaret, nextCaret );
			textareaRef.current?.focus();
		} );
	};

	const submit = async () => {
		if ( isBusy ) {
			return;
		}
		if ( ! expression.trim() ) {
			onError?.( __( 'Enter a formula.', 'cortext' ) );
			return;
		}
		try {
			await onSubmit( expression.trim() );
		} catch ( apiError ) {
			onError?.(
				apiError?.message ||
					__( "We couldn't save the formula.", 'cortext' )
			);
		}
	};

	return (
		<div className="cortext-formula-config">
			{ errorMessage ? (
				<Notice status="error" isDismissible={ false }>
					{ errorMessage }
				</Notice>
			) : null }
			<div className="cortext-formula-config__editor">
				<div className="cortext-formula-config__header">
					<label
						className="components-base-control__label cortext-formula-config__label"
						htmlFor={ editorId.current }
					>
						{ __( 'Formula', 'cortext' ) }
					</label>
					<Button
						className="cortext-formula-config__reference-toggle"
						icon={ isReferenceOpen ? unseenIcon : seenIcon }
						variant="secondary"
						size="small"
						isPressed={ isReferenceOpen }
						label={
							isReferenceOpen
								? __( 'Hide formula reference', 'cortext' )
								: __( 'Show formula reference', 'cortext' )
						}
						onClick={ () =>
							setIsReferenceOpen( ( isOpen ) => ! isOpen )
						}
						aria-expanded={ isReferenceOpen }
					>
						{ __( 'Formula reference', 'cortext' ) }
					</Button>
				</div>
				<div className="cortext-formula-config__input">
					<pre
						className="cortext-formula-config__highlight"
						aria-hidden="true"
					>
						<code
							style={ {
								transform: `translate(${ -editorScroll.left }px, ${ -editorScroll.top }px)`,
							} }
						>
							{ highlightedTokens.map( ( token, index ) => (
								<span
									key={ index }
									className={ `cortext-formula-token cortext-formula-token--${ token.type }` }
								>
									{ token.text }
								</span>
							) ) }
						</code>
					</pre>
					<textarea
						id={ editorId.current }
						ref={ textareaRef }
						className="cortext-formula-config__textarea"
						value={ expression }
						onChange={ ( event ) => {
							const next = event.currentTarget.value;
							setExpression( next );
							syncAutocomplete(
								next,
								event.currentTarget.selectionStart
							);
						} }
						onClick={ ( event ) =>
							syncAutocomplete(
								event.currentTarget.value,
								event.currentTarget.selectionStart
							)
						}
						onKeyUp={ ( event ) => {
							if (
								suggestions.length > 0 &&
								AUTOCOMPLETE_CONTROL_KEYS.has( event.key )
							) {
								return;
							}
							syncAutocomplete(
								event.currentTarget.value,
								event.currentTarget.selectionStart
							);
						} }
						onKeyDown={ ( event ) => {
							if ( suggestions.length === 0 ) {
								return;
							}
							if ( event.key === 'ArrowDown' ) {
								event.preventDefault();
								setActiveIndex(
									( index ) =>
										( index + 1 ) % suggestions.length
								);
							} else if ( event.key === 'ArrowUp' ) {
								event.preventDefault();
								setActiveIndex(
									( index ) =>
										( index - 1 + suggestions.length ) %
										suggestions.length
								);
							} else if (
								event.key === 'Enter' ||
								event.key === 'Tab'
							) {
								event.preventDefault();
								selectSuggestion(
									suggestions[ activeIndex ] ??
										suggestions[ 0 ]
								);
							} else if ( event.key === 'Escape' ) {
								setActiveMatch( null );
							}
						} }
						onScroll={ ( event ) =>
							setEditorScroll( {
								left: event.currentTarget.scrollLeft,
								top: event.currentTarget.scrollTop,
							} )
						}
						placeholder={ 'field("Price") + field("Tax")' }
						rows={ 5 }
						disabled={ isBusy }
						spellCheck="false"
					/>
				</div>
				{ suggestions.length > 0 ? (
					<div
						className="cortext-formula-config__suggestions"
						role="listbox"
					>
						{ suggestions.map( ( suggestion, index ) => (
							<button
								key={ `${ suggestion.kind }-${ suggestion.label }` }
								type="button"
								className={
									'cortext-formula-config__suggestion' +
									( index === activeIndex
										? ' is-active'
										: '' )
								}
								onMouseDown={ ( event ) => {
									event.preventDefault();
									selectSuggestion( suggestion );
								} }
								role="option"
								aria-selected={ index === activeIndex }
							>
								<span className="cortext-formula-config__suggestion-copy">
									<span>
										{ suggestion.signature ??
											suggestion.label }
									</span>
									{ suggestion.description ? (
										<small>
											{ suggestion.description }
										</small>
									) : null }
								</span>
								<code>{ suggestion.type }</code>
							</button>
						) ) }
					</div>
				) : null }
			</div>
			{ isReferenceOpen ? (
				<div className="cortext-formula-config__reference-panel">
					<FormulaReference />
				</div>
			) : (
				<div className="cortext-formula-config__reference">
					<div>
						<span className="cortext-formula-config__reference-label">
							{ __( 'Fields', 'cortext' ) }
						</span>
						<code>{ 'field("Name")' }</code>
					</div>
					<div>
						<span className="cortext-formula-config__reference-label">
							{ __( 'Operators', 'cortext' ) }
						</span>
						<span>{ OPERATORS.join( ' ' ) }</span>
					</div>
					<div>
						<span className="cortext-formula-config__reference-label">
							{ __( 'Functions', 'cortext' ) }
						</span>
						<span>{ FUNCTIONS.join( ', ' ) }</span>
					</div>
					<div>
						<span className="cortext-formula-config__reference-label">
							{ __( 'Example', 'cortext' ) }
						</span>
						<code>
							{ 'dateBetween(now(), field("Created"), "days")' }
						</code>
					</div>
				</div>
			) }
			<div className="cortext-add-field-popover__actions">
				<Button
					variant="tertiary"
					onClick={ onBack }
					disabled={ isBusy }
				>
					{ backLabel }
				</Button>
				<Button
					variant="primary"
					onClick={ submit }
					isBusy={ isBusy }
					disabled={ isBusy || ! expression.trim() }
				>
					{ submitLabel }
				</Button>
			</div>
		</div>
	);
}

function FormulaReference() {
	return (
		<div className="cortext-formula-reference">
			<div className="cortext-formula-reference__header">
				<strong>{ __( 'Formula language', 'cortext' ) }</strong>
				<span>{ __( 'v0', 'cortext' ) }</span>
			</div>
			<FormulaReferenceSection title={ __( 'Fields', 'cortext' ) }>
				<FormulaReferenceRow
					code={ 'field("Price")' }
					text={ __( 'Use a value from this row.', 'cortext' ) }
				/>
				<FormulaReferenceRow
					code={ 'prop("Price")' }
					text={ __( 'Works the same as field().', 'cortext' ) }
				/>
				<FormulaReferenceRow
					code={ 'field("Title")' }
					text={ __(
						'Built-in fields: Title, Created, Last edited.',
						'cortext'
					) }
				/>
				<p>
					{ __(
						'Use single-value fields, formulas, and built-in fields. Multi-select, relation, and rollup fields are not available in v0.',
						'cortext'
					) }
				</p>
			</FormulaReferenceSection>
			<FormulaReferenceSection title={ __( 'Values', 'cortext' ) }>
				<FormulaReferenceRow
					code={ '"hello"' }
					text={ __( 'Text', 'cortext' ) }
				/>
				<FormulaReferenceRow
					code={ '12.5' }
					text={ __( 'Number', 'cortext' ) }
				/>
				<FormulaReferenceRow
					code={ 'true' }
					text={ __( 'True', 'cortext' ) }
				/>
				<FormulaReferenceRow
					code={ 'false' }
					text={ __( 'False', 'cortext' ) }
				/>
			</FormulaReferenceSection>
			<FormulaReferenceSection title={ __( 'Operators', 'cortext' ) }>
				<FormulaReferenceRow
					code={ '+  -  *  /' }
					text={ __(
						'Use +, -, *, and /. The + operator also joins text.',
						'cortext'
					) }
				/>
				<FormulaReferenceRow
					code={ '( ... )' }
					text={ __( 'Group parts of a formula.', 'cortext' ) }
				/>
				<FormulaReferenceRow
					code={ '=  ==  !=  >  <  >=  <=' }
					text={ __(
						'Comparisons return true or false.',
						'cortext'
					) }
				/>
			</FormulaReferenceSection>
			<FormulaReferenceSection title={ __( 'Text', 'cortext' ) }>
				<FormulaReferenceRow
					code={ 'concat(a, b, ...)' }
					text={ __( 'Join values.', 'cortext' ) }
				/>
				<FormulaReferenceRow
					code={ 'length(text)' }
					text={ __( 'Count characters.', 'cortext' ) }
				/>
				<FormulaReferenceRow
					code={ 'upper(text)' }
					text={ __( 'Make text uppercase.', 'cortext' ) }
				/>
				<FormulaReferenceRow
					code={ 'lower(text)' }
					text={ __( 'Make text lowercase.', 'cortext' ) }
				/>
				<FormulaReferenceRow
					code={ 'contains(text, search)' }
					text={ __(
						'Check whether text contains a match.',
						'cortext'
					) }
				/>
			</FormulaReferenceSection>
			<FormulaReferenceSection title={ __( 'Conditionals', 'cortext' ) }>
				<FormulaReferenceRow
					code={ 'if(condition, then, else)' }
					text={ __(
						'The then and else values must use the same type in v0.',
						'cortext'
					) }
				/>
			</FormulaReferenceSection>
			<FormulaReferenceSection title={ __( 'Dates', 'cortext' ) }>
				<FormulaReferenceRow
					code={ 'now()' }
					text={ __( 'Current date and time.', 'cortext' ) }
				/>
				<FormulaReferenceRow
					code={ 'dateBetween(a, b, "days")' }
					text={ __(
						'Difference between two dates. Units: minutes, hours, days, weeks, months, years.',
						'cortext'
					) }
				/>
				<FormulaReferenceRow
					code={ 'formatDate(d, "YYYY-MM-DD")' }
					text={ __(
						'Format a date as text. Tokens: YYYY, Y, MMMM, MMM, MM, DD, D, h, mm, A.',
						'cortext'
					) }
				/>
			</FormulaReferenceSection>
		</div>
	);
}

function FormulaReferenceSection( { title, children } ) {
	return (
		<section className="cortext-formula-reference__section">
			<h4>{ title }</h4>
			{ children }
		</section>
	);
}

function FormulaReferenceRow( { code, text } ) {
	return (
		<div className="cortext-formula-reference__row">
			<code>{ code }</code>
			<span>{ text }</span>
		</div>
	);
}
