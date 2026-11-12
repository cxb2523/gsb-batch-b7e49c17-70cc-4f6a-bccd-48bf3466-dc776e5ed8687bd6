// Loaded by index.html before the app. Excalidraw reads this while its own code loads, which
// happens before any of our modules run, and the content security policy rules out an inline script.
// vite.config.ts copies the fonts into the build at this path.
window.EXCALIDRAW_ASSET_PATH = '/excalidraw-assets/';
