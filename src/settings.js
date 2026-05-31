const DEFAULT_FEATURES = {
	publicWebAffordances: true,
	wordpressAffordances: true,
};

function rawFeatureValue( key ) {
	const settings =
		typeof window === 'undefined' ? undefined : window.cortextSettings;
	return settings?.features?.[ key ];
}

export function getCortextFeatures() {
	return {
		publicWebAffordances:
			rawFeatureValue( 'publicWebAffordances' ) ??
			DEFAULT_FEATURES.publicWebAffordances,
		wordpressAffordances:
			rawFeatureValue( 'wordpressAffordances' ) ??
			DEFAULT_FEATURES.wordpressAffordances,
	};
}

export function isPublicWebAffordancesEnabled() {
	return getCortextFeatures().publicWebAffordances !== false;
}

export function isWordPressAffordancesEnabled() {
	return getCortextFeatures().wordpressAffordances !== false;
}
