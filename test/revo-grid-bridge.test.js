// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/define-custom-elements.js', () => ({
  defineCustomElement() {
    if (!customElements.get('revo-grid')) {
      customElements.define(
        'revo-grid',
        class RevoGridElement extends HTMLElement {
          connectedCallback() {
            this.dispatchEvent(
              new CustomEvent('created', {
                detail: { ready: true },
              }),
            );
          }
        },
      );
    }
  },
}));

const { default: RevoGrid } = await import(
  '../src/lib/components/RevoGrid.react.js'
);

let container;
let root;

afterEach(async () => {
  if (root) {
    await act(async () => root.unmount());
  }
  container?.remove();
  container = undefined;
  root = undefined;
});

async function render(props) {
  if (!root) {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  }
  await act(async () => {
    root.render(React.createElement(RevoGrid, props));
  });
  return container.querySelector('revo-grid');
}

describe('RevoGrid Dash bridge', () => {
  it('captures lifecycle events emitted when the element connects', async () => {
    const setProps = vi.fn();
    await render({
      eventListeners: ['created'],
      setProps,
    });
    expect(setProps).toHaveBeenCalledTimes(1);
    expect(setProps.mock.calls[0][0].eventData).toMatchObject({
      name: 'created',
      detail: { ready: true },
      sequence: 1,
    });
    expect(setProps.mock.calls[0][0].created).toEqual(
      setProps.mock.calls[0][0].eventData,
    );
  });

  it('assigns grid props and emits compact repeated edit events', async () => {
    const setProps = vi.fn();
    const source = [{ name: 'Ada' }];
    const element = await render({
      source,
      columns: [{ prop: 'name' }],
      setProps,
    });
    expect(element.source).toBe(source);

    const detail = {
      rowIndex: 0,
      colIndex: 0,
      prop: 'name',
      val: 'Grace',
      type: 'rgRow',
      colType: 'rgCol',
      model: { name: 'Grace', extra: true },
    };
    element.dispatchEvent(new CustomEvent('afteredit', { detail }));
    element.dispatchEvent(new CustomEvent('afteredit', { detail }));

    expect(setProps).toHaveBeenCalledTimes(2);
    expect(setProps.mock.calls[0][0]).not.toHaveProperty('source');
    expect(setProps.mock.calls[0][0].afteredit.detail).not.toHaveProperty(
      'model',
    );
    expect(setProps.mock.calls[0][0].afteredit.sequence).toBe(1);
    expect(setProps.mock.calls[1][0].afteredit.sequence).toBe(2);
  });

  it('increments the sequence for identical repeated payloads', async () => {
    const setProps = vi.fn();
    const element = await render({
      eventListeners: ['created'],
      setProps,
    });
    // The mock element emits `created` once on connect (sequence 1).
    expect(setProps).toHaveBeenCalledTimes(1);
    expect(setProps.mock.calls[0][0].eventData).toMatchObject({
      name: 'created',
      detail: { ready: true },
      sequence: 1,
    });

    element.dispatchEvent(
      new CustomEvent('created', { detail: { ready: true } }),
    );
    expect(setProps).toHaveBeenCalledTimes(2);
    const second = setProps.mock.calls[1][0];
    expect(second.eventData).toMatchObject({
      name: 'created',
      detail: { ready: true },
      sequence: 2,
    });
    expect(second.created).toEqual(second.eventData);
    expect(second.eventData).not.toEqual(
      setProps.mock.calls[0][0].eventData,
    );
  });

  it('deduplicates and filters eventListeners entries', async () => {
    const setProps = vi.fn();
    const element = await render({
      eventListeners: ['created', 'created', '', null, 'created'],
      setProps,
    });
    setProps.mockClear();
    element.dispatchEvent(
      new CustomEvent('created', { detail: { ready: true } }),
    );
    expect(setProps).toHaveBeenCalledTimes(1);
  });

  it('rebinds listeners when the subscription list changes', async () => {
    const setProps = vi.fn();
    const element = await render({
      eventListeners: ['created'],
      setProps,
    });
    // Re-render with a swapped subscription list.
    await render({
      eventListeners: ['contentsizechanged'],
      setProps,
    });
    setProps.mockClear();

    // The unsubscribed event must not produce callbacks anymore.
    element.dispatchEvent(
      new CustomEvent('created', { detail: { ready: true } }),
    );
    expect(setProps).not.toHaveBeenCalled();

    // The newly subscribed event flows through eventData.
    element.dispatchEvent(
      new CustomEvent('contentsizechanged', {
        detail: { width: 640, height: 480 },
      }),
    );
    expect(setProps).toHaveBeenCalledTimes(1);
    const update = setProps.mock.calls[0][0];
    expect(update.eventData).toMatchObject({
      name: 'contentsizechanged',
      detail: { width: 640, height: 480 },
      sequence: 2,
    });
    // Registered events also update their same-name Dash property.
    expect(update.contentsizechanged).toEqual(update.eventData);

    // Re-rendering with an unchanged list must not double-bind.
    await render({
      eventListeners: ['contentsizechanged'],
      setProps,
    });
    setProps.mockClear();
    element.dispatchEvent(
      new CustomEvent('contentsizechanged', {
        detail: { width: 641, height: 480 },
      }),
    );
    expect(setProps).toHaveBeenCalledTimes(1);
  });

  it('serializes hostile payloads into JSON-safe envelopes', async () => {
    const setProps = vi.fn();
    const element = await render({
      eventListeners: ['aftercolumnsset'],
      setProps,
    });
    const circular = { label: 'loop' };
    circular.self = circular;
    class Widget {
      constructor() {
        this.x = 1;
      }
    }
    element.dispatchEvent(
      new CustomEvent('aftercolumnsset', {
        detail: {
          when: new Date('2026-01-02T03:04:05.000Z'),
          count: Number.NaN,
          ratio: Number.POSITIVE_INFINITY,
          node: element,
          circular,
          widget: new Widget(),
          handler: () => {},
          sym: Symbol('skip'),
          missing: undefined,
          list: [1, () => {}, undefined, 'ok'],
          nested: { bad: Number.NaN, good: 'yes' },
        },
      }),
    );
    expect(setProps).toHaveBeenCalledTimes(1);
    const envelope = setProps.mock.calls[0][0].eventData;
    expect(envelope.detail).toEqual({
      when: '2026-01-02T03:04:05.000Z',
      count: null,
      ratio: null,
      node: null,
      circular: { label: 'loop', self: null },
      widget: null,
      list: [1, null, null, 'ok'],
      nested: { bad: null, good: 'yes' },
    });
    expect(() => JSON.stringify(envelope)).not.toThrow();
  });

  it('keeps only the edit delta for range-style afteredit details', async () => {
    const setProps = vi.fn();
    const element = await render({ setProps });
    element.dispatchEvent(
      new CustomEvent('afteredit', {
        detail: {
          type: 'rgRow',
          data: { 0: { name: 'Grace' } },
          models: { 0: { name: 'Grace', extra: true } },
          newRange: { x: 0, y: 0, x1: 0, y1: 0 },
          oldRange: { x: 0, y: 0, x1: 0, y1: 0 },
        },
      }),
    );
    expect(setProps).toHaveBeenCalledTimes(1);
    const detail = setProps.mock.calls[0][0].afteredit.detail;
    expect(detail).toEqual({
      type: 'rgRow',
      data: { 0: { name: 'Grace' } },
      newRange: { x: 0, y: 0, x1: 0, y1: 0 },
      oldRange: { x: 0, y: 0, x1: 0, y1: 0 },
    });
    expect(detail).not.toHaveProperty('models');
  });

  it('syncs source only when enabled and cleans generic listeners', async () => {
    const setProps = vi.fn();
    const element = await render({
      source: [{ name: 'Ada' }],
      eventListeners: ['created'],
      syncSourceOnEdit: true,
      setProps,
    });
    element.source[0].name = 'Grace';
    element.dispatchEvent(
      new CustomEvent('afteredit', {
        detail: {
          rowIndex: 0,
          prop: 'name',
          val: 'Grace',
          type: 'rgRow',
        },
      }),
    );
    expect(setProps.mock.calls.at(-1)[0].source).toEqual([{ name: 'Grace' }]);
    expect(setProps.mock.calls.at(-1)[0].source).not.toBe(element.source);

    await render({
      source: element.source,
      eventListeners: ['runtimepluginchange'],
      syncSourceOnEdit: true,
      setProps,
    });
    setProps.mockClear();
    element.dispatchEvent(new CustomEvent('created', { detail: {} }));
    element.dispatchEvent(
      new CustomEvent('runtimepluginchange', { detail: { ready: true } }),
    );
    expect(setProps).toHaveBeenCalledTimes(1);
    expect(setProps.mock.calls[0][0].eventData.name).toBe(
      'runtimepluginchange',
    );
    expect(setProps.mock.calls[0][0]).not.toHaveProperty(
      'runtimepluginchange',
    );
  });
});
