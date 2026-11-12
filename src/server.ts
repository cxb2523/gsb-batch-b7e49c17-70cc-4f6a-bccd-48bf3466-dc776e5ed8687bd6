import { execSync } from 'child_process';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListPromptsRequestSchema, ListResourcesRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { WebSocket } from 'ws';

import pkg from '../package.json' with { type: 'json' };

import { parsePids } from './pids.ts';
import { register as registerAnimation } from './tools/animation.ts';
import { register as registerAnimStateGraph } from './tools/animstategraph.ts';
import { register as registerAsset } from './tools/asset.ts';
import { register as registerAssetMaterial } from './tools/assets/material.ts';
import { register as registerAssetScript } from './tools/assets/script.ts';
import { register as registerBuild } from './tools/build.ts';
import { register as registerEditor } from './tools/editor.ts';
import { register as registerEntity } from './tools/entity.ts';
import { register as registerProcessing } from './tools/processing.ts';
import { register as registerProject } from './tools/project.ts';
import { register as registerProjects } from './tools/projects.ts';
import { register as registerRuntime } from './tools/runtime.ts';
import { register as registerScene } from './tools/scene.ts';
import { register as registerStore } from './tools/store.ts';
import { register as registerVcs } from './tools/vcs.ts';
import { register as registerViewport } from './tools/viewport.ts';
import { WSS } from './wss.ts';

const PORT = parseInt(process.env.PORT || '52000', 10);

// deduped PIDs listening on the port; parsing lives in parsePids so it's unit-testable
const findPids = (port: number): string[] => {
    try {
        const cmd = process.platform === 'win32' ?
            'netstat -ano -p TCP' :
            `lsof -nP -iTCP:${port} -sTCP:LISTEN -t`;
        return parsePids(execSync(cmd).toString(), process.platform, port);
    } catch {
        // No listener (lsof/netstat exit non-zero when nothing matches), or the
        // platform tool is unavailable. Standing by is still safe: never kill.
        return [];
    }
};

const own = String(process.pid);
const stale = () => findPids(PORT).filter(p => p !== own);

// Wait — with a bounded timeout so startup never hangs — for the port to free up.
const waitForPortFree = (timeoutMs: number) => {
    const deadline = Date.now() + timeoutMs;
    return new Promise<void>((resolve) => {
        const tick = () => {
            if (!stale().length || Date.now() >= deadline) {
                resolve();
                return;
            }
            setTimeout(tick, 250);
        };
        tick();
    });
};

// Ask whoever currently owns the port to gracefully hand it off, so the *newest*
// (active) client ends up controlling the editor. The owner releases the port
// without exiting, so its MCP client doesn't restart it — no kill/restart storm.
const requestYield = (port: number, timeoutMs: number) => {
    return new Promise<void>((resolve) => {
        let settled = false;
        const done = () => {
            if (!settled) {
                settled = true;
                resolve();
            }
        };
        let ws: WebSocket;
        try {
            ws = new WebSocket(`ws://127.0.0.1:${port}`);
        } catch {
            done();
            return;
        }
        const timer = setTimeout(() => {
            try {
                ws.close();
            } catch { /* noop */ }
            done();
        }, timeoutMs);
        ws.on('open', () => {
            try {
                ws.send(JSON.stringify({ yield: true }));
            } catch { /* noop */ }
        });
        ws.on('close', () => {
            clearTimeout(timer);
            done();
        });
        ws.on('error', () => {
            clearTimeout(timer);
            done();
        });
    });
};

// Take over the port from an existing instance with a *graceful* handoff only.
// We never terminate the current owner: it may belong to another agent's MCP
// client, and killing it would leave that client without a server. If it yields,
// we bind; if it doesn't (old build, hung), WSS stands by and retries binding
// until the port frees up on its own.
console.error('[process] Requesting a graceful handoff from any instance on port', PORT, '(no process is terminated)');
await requestYield(PORT, 1500);
await waitForPortFree(3000);
const remaining = stale();
if (remaining.length) {
    console.error('[process] Port', PORT, 'is still owned by', remaining.join(', '), '— standing by and retrying; this instance takes over automatically when that owner exits.');
}

// Create a WebSocket server
const wss = new WSS(PORT);

// Create an MCP server
const mcp = new McpServer({
    name: 'PlayCanvas',
    version: pkg.version
}, {
    capabilities: {
        tools: {},
        resources: {},
        prompts: {}
    }
});
mcp.server.setRequestHandler(ListResourcesRequestSchema, () => ({ resources: [] }));
mcp.server.setRequestHandler(ListPromptsRequestSchema, () => ({ prompts: [] }));

// Tools
registerEntity(mcp, wss);
registerAsset(mcp, wss);
registerAssetMaterial(mcp, wss);
registerAssetScript(mcp, wss);
registerAnimation(mcp, wss);
registerAnimStateGraph(mcp, wss);
registerProcessing(mcp, wss);
registerBuild(mcp, wss);
registerScene(mcp, wss);
registerProject(mcp, wss);
registerProjects(mcp, wss);
registerStore(mcp, wss);
registerViewport(mcp, wss);
registerRuntime(mcp, wss);
registerEditor(mcp, wss);
registerVcs(mcp, wss);

// Start receiving messages on stdin and sending messages on stdout
const transport = new StdioServerTransport();
mcp.connect(transport).then(() => {
    console.error('[MCP] Listening');
}).catch((e) => {
    console.error('[MCP] Error', e);
    process.exit(1);
});

const close = () => {
    mcp.close().finally(() => {
        console.error('[MCP] Closed');
        wss.close();
        process.exit(0);
    });
};

// Handle uncaught exceptions and unhandled rejections
process.on('uncaughtException', (err) => {
    console.error('[process] Uncaught exception', err);
    console.error('[process] Stack:', err.stack);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('[process] Unhandled rejection at:', promise);
    console.error('[process] Reason:', reason);
});
process.on('exit', (code) => {
    console.error('[process] Exit with code:', code);
});

// Clean up on exit
process.stdin.on('close', () => {
    console.error('[process] stdin closed');
    close();
});
process.stdin.on('end', () => {
    console.error('[process] stdin ended');
    close();
});

// If our parent process dies we get reparented to init (ppid 1). That means our
// MCP client/launcher is gone but we were left running — the main way stale
// servers pile up and keep hogging the port. Detect it and exit so the port is
// released for the active client instead of lingering as an orphan.
if (process.platform !== 'win32') {
    const parentWatch = setInterval(() => {
        if (process.ppid === 1) {
            console.error('[process] Parent gone (reparented to init); exiting to release the port');
            clearInterval(parentWatch);
            close();
        }
    }, 2000);
    parentWatch.unref();
}
process.on('SIGINT', () => {
    console.error('[process] SIGINT');
    close();
});
process.on('SIGTERM', () => {
    console.error('[process] SIGTERM');
    close();
});
process.on('SIGQUIT', () => {
    console.error('[process] SIGQUIT');
    close();
});
