import type { ReactiveController, ReactiveControllerHost } from 'lit';
import { onLanguageLoaded } from './localize';

/**
 * Draws its element again whenever a language's strings arrive, so a card or editor that first
 * drew in English while the user's language was still loading switches over by itself.
 */
export class LanguageController implements ReactiveController {
  private stop?: () => void;

  constructor(private readonly host: ReactiveControllerHost) {
    host.addController(this);
  }

  hostConnected(): void {
    this.stop = onLanguageLoaded(() => this.host.requestUpdate());
  }

  hostDisconnected(): void {
    this.stop?.();
    this.stop = undefined;
  }
}
