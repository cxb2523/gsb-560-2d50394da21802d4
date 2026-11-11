import { TGraph, TLink, compileBlock, paramDefaults } from ".";
import { describe, expect, it } from "vitest";

// Граф из списка нод [тип, конфиг] и связей (как в blockCompiler.test.ts)
const graph = (nodes: [string, Record<string, unknown>?][], connect: TLink[]): TGraph => ({
  nodes: nodes.map(([type]) => type),
  configs: nodes.map(([, config]) => ({ x: 0, y: 0, ...config })),
  connect,
});

const IN = (slot = 'in1'): [string, Record<string, unknown>] => ['GroupInput', { slot, label: 'in' }];
const OUT = (slot = 'out1'): [string, Record<string, unknown>] => ['GroupOutput', { slot, label: 'out' }];
const MATH = (op: string, values: Record<string, number> = {}): [string, Record<string, unknown>] => (
  ['Math', { _p: op, _a: 0, _b: 0, _c: 0, _d: 0, _e: 0, ...values }]
);

const compiled = (g: TGraph) => {
  const result = compileBlock(g);

  if (!result.ok)
    throw new Error(result.reason);

  return result;
};

describe('block compiler: unwired inputs diagnostics', () => {
  it('reports an unwired Math input with its node and port', () => {
    // in → plus(·, ?) → out: второй вход plus без провода
    const g = graph(
      [IN(), MATH('plus', { _b: 3 }), OUT()],
      [
        [[0, 0], [1, 0]],
        [[1, 2], [2, 0]],
      ]
    );
    const result = compiled(g);

    expect(result.unwiredInputs).toEqual([{ node: 1, input: 1, type: 'Math' }]);
    // Диагностика соответствует живому параметру и его значению из paramDefaults
    expect(result.params).toEqual([{ node: 1, key: '_b' }]);
    expect(result.unwiredInputs.map(({ node }) => node)).toEqual(result.params.map(({ node }) => node));
    expect(paramDefaults(g, result.params)).toEqual([3]);
  });

  it('reports every unwired input of a node in port order', () => {
    const result = compiled(graph([MATH('plus'), OUT()], [[[0, 2], [1, 0]]]));

    expect(result.unwiredInputs).toEqual([
      { node: 0, input: 0, type: 'Math' },
      { node: 0, input: 1, type: 'Math' },
    ]);
    expect(result.params).toEqual([{ node: 0, key: '_a' }, { node: 0, key: '_b' }]);
  });

  it('reports an empty list when every input is wired', () => {
    const result = compiled(graph(
      [IN('a'), IN('b'), MATH('plus'), OUT()],
      [
        [[0, 0], [2, 0]],
        [[1, 0], [2, 1]],
        [[2, 2], [3, 0]],
      ]
    ));

    expect(result.unwiredInputs).toEqual([]);
  });

  it('does not report a GroupOutput input whose key is null', () => {
    // Вход GroupOutput без провода — тишина на выходе, а не «немой» вход ноды
    const lone = compiled(graph([OUT()], []));
    expect(lone.unwiredInputs).toEqual([]);

    // То же, когда выход блока подключён
    const wired = compiled(graph([IN(), OUT()], [[[0, 0], [1, 0]]]));
    expect(wired.unwiredInputs).toEqual([]);
  });

  it('omits the field entirely when compilation fails', () => {
    const result = compileBlock(graph([['Oscillator'], OUT()], []));

    expect(result.ok).toBe(false);
    expect('unwiredInputs' in result).toBe(false);
  });

  it('keeps slots and node types out of the generated source', () => {
    const slot = '"]; fetch("x"); //';
    const result = compiled(graph([IN(slot), MATH('plus', { _b: 1 }), OUT(slot)], [[[0, 0], [1, 0]], [[1, 2], [2, 0]]]));

    expect(result.unwiredInputs).toEqual([{ node: 1, input: 1, type: 'Math' }]);
    expect(result.source).not.toContain('fetch');
    expect(result.source).not.toContain(slot);
    // Диагностика живёт только в поле результата, её текст в код не попадает
    expect(result.source).not.toContain('unwiredInputs');
  });
});
