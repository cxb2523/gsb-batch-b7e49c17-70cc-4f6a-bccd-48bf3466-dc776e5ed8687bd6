import { describe, expect, it, vi, afterEach } from 'vitest';
import { createAnalyzerManager, AnalyzerHtml } from '../../src';
import { AnalyzerException } from '../../src/exception/AnalyzerException';
import { JsVmException } from '../../src/exception/JsVmException';

const manager = createAnalyzerManager();

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AnalyzerManager 错误定位：异常需带规则片段并保留原始错误', () => {
  it('坏 CSS 选择器抛出含规则片段的 AnalyzerException', async () => {
    const rule = '@css:!!!bad@text';
    await expect(manager.getString(rule, '<div>x</div>')).rejects.toBeInstanceOf(AnalyzerException);
    await expect(manager.getString(rule, '<div>x</div>')).rejects.toMatchObject({
      message: expect.stringContaining('!!!bad')
    });
  });

  it('多段规则中坏 CSS 的异常指明出错的那一段并保留原始错误', async () => {
    const rule = '$.html@css:!!!bad@text';
    const body = JSON.stringify({ html: '<div>x</div>' });
    const p = manager.getString(rule, body);
    await expect(p).rejects.toBeInstanceOf(AnalyzerException);
    await expect(p).rejects.toMatchObject({
      message: expect.stringContaining('@css:!!!bad@text')
    });
    await expect(p).rejects.toMatchObject({
      message: expect.stringContaining('Empty sub-selector')
    });
  });

  it('坏 XPath 抛出含规则片段的 AnalyzerException', async () => {
    const rule = '@xpath://[';
    const p = manager.getStringList(rule, '<div>x</div>');
    await expect(p).rejects.toBeInstanceOf(AnalyzerException);
    await expect(p).rejects.toMatchObject({
      message: expect.stringContaining('//[')
    });
    await expect(p).rejects.toMatchObject({
      message: expect.stringContaining('XPath parse error')
    });
  });

  it('JS 段抛错时 JsVmException 带上规则片段与原始错误', async () => {
    const rule = '@js:throw new Error("boom")';
    const p = manager.getString(rule, '');
    await expect(p).rejects.toBeInstanceOf(JsVmException);
    await expect(p).rejects.toMatchObject({
      message: expect.stringContaining('throw new Error("boom")')
    });
    await expect(p).rejects.toMatchObject({
      message: expect.stringContaining('boom')
    });
  });

  it('多段规则中 JS 段抛错能定位到具体片段', async () => {
    const rule = '$.a@js:throw new Error("segment-boom")';
    const p = manager.getString(rule, JSON.stringify({ a: 'data' }));
    await expect(p).rejects.toBeInstanceOf(JsVmException);
    await expect(p).rejects.toMatchObject({
      message: expect.stringContaining('@js:throw new Error("segment-boom")')
    });
    await expect(p).rejects.toMatchObject({
      message: expect.stringContaining('segment-boom')
    });
  });

  it('包装后的异常通过 cause 保留原始错误对象', async () => {
    const rule = '@css:!!!bad@text';
    await expect(manager.getString(rule, '<div>x</div>')).rejects.toMatchObject({
      cause: expect.objectContaining({
        message: expect.stringContaining('Empty sub-selector')
      })
    });
  });
});

describe('AnalyzerManager 空结果短路：某段返回空后不再调用后续解析器', () => {
  it('getString：首段 JSONPath 返回空，后续 CSS 解析器不被调用，整体返回空字符串', async () => {
    const getStringSpy = vi.spyOn(AnalyzerHtml.prototype, 'getString');
    const rule = '$.missing@css:.box@text';
    const body = JSON.stringify({ a: 'x' });

    const result = await manager.getString(rule, body);

    expect(result).toEqual('');
    expect(getStringSpy).not.toHaveBeenCalled();
  });

  it('getStringList：首段返回空数组，后续 CSS 解析器不被调用，整体返回空数组', async () => {
    const getStringListSpy = vi.spyOn(AnalyzerHtml.prototype, 'getStringList');
    const rule = '$.missing@css:.box';
    const body = JSON.stringify({ a: 'x' });

    const result = await manager.getStringList(rule, body);

    expect(result).toEqual([]);
    expect(getStringListSpy).not.toHaveBeenCalled();
  });

  it('getElements：首段返回空，后续 CSS 解析器不被调用，整体返回空数组', async () => {
    const getElementsSpy = vi.spyOn(AnalyzerHtml.prototype, 'getElements');
    const rule = '$.missing@css:.box';
    const body = JSON.stringify({ a: 'x' });

    const result = await manager.getElements(rule, body);

    expect(result).toEqual([]);
    expect(getElementsSpy).not.toHaveBeenCalled();
  });

  it('CSS 段匹配为空时，链路后续解析器不被调用', async () => {
    const getStringSpy = vi.spyOn(AnalyzerHtml.prototype, 'getString');
    // 第一段 CSS 选择器匹配不到任何元素
    const rule = '@css:.not-exist@text@css:.box@text';
    const body = '<div class="box">hello</div>';

    const result = await manager.getString(rule, body);

    expect(result).toEqual('');
    // 第一段自身解析一次，第二段（.box）不应被执行
    expect(getStringSpy).toHaveBeenCalledTimes(1);
  });

  it('前置段有结果时后续解析器仍正常执行', async () => {
    const getStringSpy = vi.spyOn(AnalyzerHtml.prototype, 'getString');
    const rule = '$.html@css:.box@text';
    const body = JSON.stringify({ html: '<div class="box">content</div>' });

    const result = await manager.getString(rule, body);

    expect(result).toEqual('content');
    expect(getStringSpy).toHaveBeenCalled();
  });
});

describe('AnalyzerManager 既有组合行为保持不变', () => {
  it('&& 仍拼接各段结果', async () => {
    const body = '<div class="a">1</div><div class="b">2</div>';
    const content = await manager.getString('.a@text&&.b@text', body);
    expect(content).toEqual('1  2');
  });

  it('|| 仍取第一个非空结果', async () => {
    const body = '{"a": "1"}';
    const content = await manager.getString('$.b||$.a', body);
    expect(content).toEqual('1');
  });

  it('## 替换、{{}} 内嵌表达式、@replace 继续可用', async () => {
    expect(await manager.getString('$.a##2##替换文本', '{"a": "123"}')).toEqual('1替换文本3');
    expect(await manager.getString('q{{$.x||$.a}}w', '{"a": 1}')).toEqual('q1w');
    expect(await manager.getString('@replace:2', '123')).toEqual('13');
  });
});
