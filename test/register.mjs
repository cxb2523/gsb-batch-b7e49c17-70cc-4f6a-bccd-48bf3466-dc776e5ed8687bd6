/**
 * Offline test loader.
 *
 * The client sources use webpack aliases (@client, @events, @server) and omit
 * file extensions from imports. This module registers Node's synchronous
 * module hooks so the sources can be imported directly by the built-in test
 * runner, without webpack or any third-party test framework.
 */
import { registerHooks } from 'node:module';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const srcRoot = path.join(projectRoot, 'src');

const ALIASES = {
    '@client': path.join(srcRoot, 'client'),
    '@events': path.join(srcRoot, 'events'),
    '@server': path.join(srcRoot, 'server'),
};

function resolveFile(candidate) {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
        return candidate;
    }

    if (existsSync(`${candidate}.js`)) {
        return `${candidate}.js`;
    }

    const index = path.join(candidate, 'index.js');

    if (existsSync(index)) {
        return index;
    }

    return null;
}

function resolveAlias(specifier) {
    for (const [alias, directory] of Object.entries(ALIASES)) {
        if (specifier === alias || specifier.startsWith(`${alias}/`)) {
            const suffix = specifier.slice(alias.length).replace(/^\//, '');
            const target = resolveFile(path.join(directory, suffix));

            return target ? pathToFileURL(target).href : null;
        }
    }

    return null;
}

registerHooks({
    resolve(specifier, context, nextResolve) {
        const aliased = resolveAlias(specifier);

        if (aliased) {
            return { url: aliased, shortCircuit: true };
        }

        // Relative imports in the client sources are written without the .js
        // extension, which is fine for webpack but not for Node's ESM resolver.
        if (
            context.parentURL &&
            (specifier.startsWith('./') || specifier.startsWith('../')) &&
            !path.extname(specifier)
        ) {
            const parentFile = fileURLToPath(context.parentURL);
            const target = resolveFile(path.resolve(path.dirname(parentFile), specifier));

            if (target) {
                return { url: pathToFileURL(target).href, shortCircuit: true };
            }
        }

        return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
        if (!url.startsWith('file:')) {
            return nextLoad(url, context);
        }

        const file = fileURLToPath(url);

        if (file.startsWith(`${srcRoot}${path.sep}`) && file.endsWith('.js')) {
            return {
                format: 'module',
                source: readFileSync(file, 'utf8'),
                shortCircuit: true,
            };
        }

        return nextLoad(url, context);
    },
});
