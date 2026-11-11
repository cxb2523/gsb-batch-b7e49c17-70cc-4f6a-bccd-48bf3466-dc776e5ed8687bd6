import { css, LitElement } from "lit";

class Tab extends LitElement {
  static styles = css`
    :host {
      display: none;
    }

    :host([visible]) {
      display: block;
    }
  `;

  static properties = {
    visible: {reflect: true, type: Boolean},
    darkened: {reflect: true, type: Boolean},
  }

  constructor(properties = {}) {
    super();

    this.properties = properties;
    this.visible = false;
    this.darkened = this.darkened || false;
  }
  tabButton;

  render() {}

  tabEnter() {}

  tabExit() {}

  setDarkened(value) {
    this.darkened = value;
    this.dispatchEvent(new CustomEvent("set-darkened", {detail: this.darkened}));
  }
}

export default Tab;