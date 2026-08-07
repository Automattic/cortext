function secureWebPreferences(
	webPreferences,
	runtimeSession,
	enableDevTools
) {
	const inheritedPreferences = { ...( webPreferences || {} ) };
	delete inheritedPreferences.partition;
	delete inheritedPreferences.preload;
	delete inheritedPreferences.session;
	return {
		...inheritedPreferences,
		session: runtimeSession,
		contextIsolation: true,
		nodeIntegration: false,
		nodeIntegrationInWorker: false,
		nodeIntegrationInSubFrames: false,
		sandbox: true,
		webviewTag: false,
		webSecurity: true,
		allowRunningInsecureContent: false,
		devTools: enableDevTools,
	};
}

module.exports = { secureWebPreferences };
