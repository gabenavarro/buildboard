/**
 * Node module-resolution hook: SvelteKit source files import each other with
 * `.js` specifiers (e.g. `./db.js`) even though the files on disk are `.ts`.
 * Node's type stripping resolves real extensions only, so when a relative
 * `.js` import fails with ERR_MODULE_NOT_FOUND, retry it as `.ts`.
 */
/**
 * @param {string} specifier
 * @param {object} context
 * @param {(s: string, c: object) => Promise<any>} nextResolve
 */
export async function resolve(specifier, context, nextResolve) {
	try {
		return await nextResolve(specifier, context);
	} catch (err) {
		const code = /** @type {{ code?: string }} */ (err)?.code;
		if (code === 'ERR_MODULE_NOT_FOUND' && specifier.endsWith('.js')) {
			return await nextResolve(specifier.replace(/\.js$/, '.ts'), context);
		}
		throw err;
	}
}
