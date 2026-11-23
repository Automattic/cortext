const DEFAULT_FEATURES = {
	publicWebAffordances: true,
	wordpressAffordances: true,
};

function getSettings() {
	return typeof window === 'undefined' ? undefined : window.cortextSettings;
}

function rawFeatureValue( key ) {
	const settings = getSettings();
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

export function getCortextExperiments() {
	const experiments = getSettings()?.experiments;
	return experiments && typeof experiments === 'object' ? experiments : {};
}

export function isExperimentEnabled( id ) {
	return getCortextExperiments()?.[ id ] === true;
}

export function canManageCortextSettings() {
	return getSettings()?.capabilities?.manageOptions === true;
}
