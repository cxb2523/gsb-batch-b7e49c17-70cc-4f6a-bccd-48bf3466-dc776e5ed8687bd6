import {build} from 'esbuild';
await build({entryPoints:['src/main/main.ts'],outfile:'dist/main/main.cjs',bundle:true,platform:'node',format:'cjs',target:'node22',external:['electron']});
await build({entryPoints:['src/main/preload.ts'],outfile:'dist/main/preload.cjs',bundle:true,platform:'node',format:'cjs',target:'node22',external:['electron']});
