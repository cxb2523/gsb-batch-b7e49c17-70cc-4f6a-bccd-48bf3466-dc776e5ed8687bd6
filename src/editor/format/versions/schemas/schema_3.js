import AJV from "../../ajv.js";

const schema = {
  type: "object",
  properties: {
    format: {type: "integer"},
    variant: {
      type: "string",
      pattern: "^(classic|slim)$"
    },
    layers: {
      type: "array",
      items: {
        type: "object",
        properties: {
          filters: {type: "array"},
          data: {type: "string"},
          metadata: {
            type: "object",
            properties: {
              attribution: {type: "string"}
            }
          },
          selected: {type: "boolean"},
          visible: {type: "boolean"},
        }
      }
    },
    blendPalette: {
      type: "array",
      items: {
        type: "string",
        pattern: "^#([a-fA-F0-9]{8}|[a-fA-F0-9]{6})$"
      }
    }
  }
}

let schema3;

function validate(data) {
  if (!schema3) {
    schema3 = AJV.compile(schema);
  }

  const valid = schema3(data);
  if (!valid) console.log(schema3.errors, data);

  return valid;
}

export default validate;