class BaseVersion {
  static format = -1;

  static exportEditor(_editor) {
    throw new Error("exportEditor not implemented!");
  }

  static loadEditor(_editor, _data) {
    throw new Error("loadEditor not implemented!");
  }

  constructor(lastVersionClass, data, format) {
    this.lastVersion = lastVersionClass;
    this.format = format;
    this.loadData(this.checkData(data));
  }
  data;

  // Extend these functions

  validateData(_data) {
    return true;
  }

  convert(data) {
    return data;
  }

  versionCheck(data) {
    return this.format == data.format;
  }

  serialize() {
    return this.data;
  }

  // Don't extend these functions unless necessary
  checkData(data) {
    if (this.versionCheck(data)) {
      return data;
    } else {
      const transformedData = this.transformData(data);
      return transformedData;
    }
  }

  transformData(data) {
    const lastVersion = new this.lastVersion(data);
    const newData = lastVersion.data;
    return this.convert(newData);
  }

  loadData(data) {
    if (this.validateData(data)) {
      this.data = data;
    } else {
      throw new Error("Invalid NCRS file!");
    }
  }
}

export default BaseVersion;