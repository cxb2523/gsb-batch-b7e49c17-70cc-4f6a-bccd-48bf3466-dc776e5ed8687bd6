import { registerPlugin, PluginListenerHandle } from '@capacitor/core';
import { Capacitor } from '@capacitor/core';
import type { ScanResult } from '../shared/lanScan';

export interface NativeShellPlugin {
  execute(options: { command: string }): Promise<{ exitCode: number }>;
  /**
   * Run one LAN scan. Rejects immediately (no native work started) when the
   * subnet fails the shared validateSubnet() rules. Resolves exactly once,
   * either with status "completed" or "cancelled".
   */
  scanLAN(options: { subnet: string }): Promise<ScanResult>;
  /** Cancel the active scan; the scanLAN promise then resolves "cancelled". */
  cancelScan(): Promise<{ cancelled: boolean }>;
  crackHash(options: { hash: string, type: string, wordlistContent: string, useMutations: boolean }): Promise<void>;
  addListener(eventName: 'stdout', listenerFunc: (data: { line: string }) => void): Promise<PluginListenerHandle>;
  addListener(eventName: 'stderr', listenerFunc: (data: { line: string }) => void): Promise<PluginListenerHandle>;
  addListener(eventName: 'completed', listenerFunc: (data: { exitCode: number, success?: boolean, plaintext?: string }) => void): Promise<PluginListenerHandle>;
  addListener(eventName: 'hostFound', listenerFunc: (data: { ip: string, status: string }) => void): Promise<PluginListenerHandle>;
  removeAllListeners(): Promise<void>;
}

export const NativeShell = registerPlugin<NativeShellPlugin>('NativeShell');

export const isNative = Capacitor.isNativePlatform();
