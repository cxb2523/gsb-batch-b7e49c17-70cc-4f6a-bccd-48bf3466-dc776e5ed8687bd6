<script lang="ts">
  let { kind = 'overview' }: { kind?: 'overview' | 'monitor' | 'camera' | 'detections' | 'alerts' | 'logs' } = $props();
</script>

<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  {#if kind === 'overview'}
    <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
  {:else if kind === 'monitor'}
    <path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h7A2.5 2.5 0 0 1 16 8.5v7a2.5 2.5 0 0 1-2.5 2.5h-7A2.5 2.5 0 0 1 4 15.5z"/><path d="m16 10 4-2.5v9L16 14z"/>
  {:else if kind === 'camera'}
    <path d="M4 8.5h11a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H4z"/><path d="m17 11 3-2v8l-3-2z"/><path d="M7 8.5 8.3 6h3.4L13 8.5"/><circle cx="10.5" cy="13.5" r="2.3"/>
  {:else if kind === 'detections'}
    <circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>
  {:else if kind === 'alerts'}
    <path d="M18 9a6 6 0 1 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/>
  {:else}
    <path d="M8 6h12M8 12h12M8 18h12"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>
  {/if}
</svg>

<style>
  svg { display:block; width:1em; height:1em; }
</style>
