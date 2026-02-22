// Replaces bun's heavy CJS interop wrapper with a minimal one.
// Bun emits ~500 bytes of __esModule/WeakMap/defineProperty boilerplate;
// Obsidian only needs `module.exports = PluginClass`.
const file = "main.js";
const src = await Bun.file(file).text();

// Find which minified name is the default export: `{default:()=>X}`
const defaultName = src.match(/\{default:\(\)=>(\w+)\}/)?.[1];
if (!defaultName) throw new Error("Could not find default export binding");

// Strip everything before the first require("obsidian")
// and remove the export binding + module.exports wrapper
const stripped = src
	.replace(/^.*?(?=var \w+=require\("obsidian"\))/, "")
	.replace(/var \w+=\{\};\w+\(\w+,\{default:\(\)=>\w+\}\);/, "");

await Bun.write(file, `"use strict";${stripped}module.exports=${defaultName};\n`);
