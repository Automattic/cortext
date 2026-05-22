import { useEffect, useState } from '@wordpress/element';

export default function useDebouncedValue( value, delay ) {
	const [ debounced, setDebounced ] = useState( value );
	useEffect( () => {
		const id = setTimeout( () => setDebounced( value ), delay );
		return () => clearTimeout( id );
	}, [ value, delay ] );
	return debounced;
}
