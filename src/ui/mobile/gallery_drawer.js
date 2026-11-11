import { css } from "lit";
import MobileDrawer from "./components/drawer";
import QuickSearch from "../config/tabs/import/quick_search";

const GALLERY_DRAWER_STYLES = css`
  #gallery-drawer {
    --drawer-height: 31rem;
  }

  ncrs-quick-search {
    display: block;
    margin-top: 2rem;
    max-width: 343px;
  }

  ncrs-quick-search::part(skins) {
    height: 300px;
  }

  ncrs-quick-search{
    margin-left: auto;
    margin-right: auto;
    --search-button-padding: 0.125rem 0.25rem;
  }
`;

class GalleryDrawer {
  constructor(ui) {
    this.ui = ui;
    this.editor = this.ui.editor;

    this.drawer = this._setupMobileDrawer();
  }
  _firstLoad = false;

  firstUpdated() {}

  render() {
    return this.drawer;
  }

  show() {
    this.drawer.show();
  }

  _setupMobileDrawer() {
    const drawer = new MobileDrawer();
    drawer.id = "gallery-drawer";

    const quickSearch = new QuickSearch(this.ui);

    drawer.appendChild(quickSearch);

    drawer.addEventListener("open", () => {
      if (this._firstLoad) return;

      quickSearch.load();
    });

    return drawer;
  }
}

export {GalleryDrawer, GALLERY_DRAWER_STYLES};