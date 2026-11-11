import BrushBaseTool from "../brush_tool.js";

class EraseTool extends BrushBaseTool {
  constructor(config) {
    super(
      config,
      {
        id: "eraser",
        icon: "eraser",
        name: "Erase [E]",
        description: "Simple tool for erasing.\nUse either the left or right mouse button to erase.",
        providesColor: false, // Whether or not drawing with this tool adds to recent colors.
        desktopLayout: true,
        mobileLayout: true,
      }
    );
  }

  down(toolData) {
    const texture = toolData.texture;
    const part = toolData.parts[0];
    const point = toolData.getCoords();
    const color = this._transparentColor;

    this.cursor = point;
    this.draw(texture, part, point, color, toolData.variant);

    return texture.toTexture();
  }

  move(toolData) {
    const texture = toolData.texture;
    const part = toolData.parts[0];
    const point = toolData.getCoords();
    const color = this._transparentColor;
    this.draw(texture, part, point, color, toolData.variant);

    return texture.toTexture();
  }
}

export default EraseTool;
