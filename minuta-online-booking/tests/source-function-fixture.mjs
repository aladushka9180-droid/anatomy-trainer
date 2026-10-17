import assert from 'node:assert/strict';
import vm from 'node:vm';

// Extract real declarations for isolated VM fixtures without depending on indentation.
// The JavaScript parser validates the boundary; application code is not executed here.
export function extractFunctionDeclaration(source, name) {
  assert.match(name, /^[A-Za-z_$][\w$]*$/);
  const starts = [...source.matchAll(new RegExp(`^[ \\t]*(?:async[ \\t]+)?function[ \\t]+${name}\\(`, 'gm'))];
  assert.equal(starts.length, 1, `one actual ${name} declaration`);
  const start = starts[0].index;
  for (const end of source.slice(start).matchAll(/^[ \t]*\}[ \t]*(?=\r?$)/gm)) {
    const declaration = source.slice(start, start + end.index + end[0].length);
    try {
      new vm.Script(`(${declaration}\n)`, { filename: `fixture-${name}.js` });
      return declaration;
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
  }
  assert.fail(`complete actual ${name} declaration`);
}
