// Construye un formulario HTML a partir de un JSON Schema (generado por
// pydantic) y permite leer los valores introducidos por el usuario.
// Esto permite que anadir una nueva metaheuristica (con sus propios
// parametros) no requiera tocar el frontend: el formulario se genera solo.

function resolveProp(prop) {
  if (prop.anyOf) {
    const nonNull = prop.anyOf.find((p) => p.type !== "null") || {};
    return { ...nonNull, title: prop.title, description: prop.description, default: prop.default };
  }
  return prop;
}

export function buildForm(formEl, schema, currentValues = {}) {
  formEl.innerHTML = "";
  const props = schema.properties || {};
  const required = new Set(schema.required || []);
  const inputs = {};

  for (const [key, propRaw] of Object.entries(props)) {
    const prop = resolveProp(propRaw);
    const wrapper = document.createElement("div");
    wrapper.className = "field-row";

    const label = document.createElement("label");
    label.textContent = prop.title || key;

    const defaultValue = currentValues[key] !== undefined ? currentValues[key] : prop.default;
    let input;

    if (prop.enum) {
      input = document.createElement("select");
      for (const opt of prop.enum) {
        const optionEl = document.createElement("option");
        optionEl.value = opt;
        optionEl.textContent = opt;
        if (opt === defaultValue) optionEl.selected = true;
        input.appendChild(optionEl);
      }
    } else if (prop.type === "integer" || prop.type === "number") {
      input = document.createElement("input");
      input.type = "number";
      if (prop.type === "number") input.step = "any";
      if (prop.minimum !== undefined) input.min = prop.minimum;
      if (prop.maximum !== undefined) input.max = prop.maximum;
      if (defaultValue !== undefined && defaultValue !== null) input.value = defaultValue;
      if (!required.has(key)) input.placeholder = "opcional";
    } else if (prop.type === "boolean") {
      input = document.createElement("input");
      input.type = "checkbox";
      input.checked = Boolean(defaultValue);
    } else {
      input = document.createElement("input");
      input.type = "text";
      if (defaultValue !== undefined && defaultValue !== null) input.value = defaultValue;
    }

    input.name = key;
    input.dataset.type = prop.type || (prop.enum ? "string" : "string");

    label.appendChild(input);
    wrapper.appendChild(label);

    if (prop.description) {
      const desc = document.createElement("div");
      desc.className = "field-desc";
      desc.textContent = prop.description;
      wrapper.appendChild(desc);
    }

    formEl.appendChild(wrapper);
    inputs[key] = input;
  }

  return inputs;
}

export function readFormValues(inputs) {
  const values = {};
  for (const [key, input] of Object.entries(inputs)) {
    if (input.type === "checkbox") {
      values[key] = input.checked;
    } else if (input.type === "number") {
      if (input.value === "") {
        values[key] = null;
      } else {
        values[key] = input.dataset.type === "integer" ? parseInt(input.value, 10) : parseFloat(input.value);
      }
    } else {
      values[key] = input.value;
    }
  }
  return values;
}
