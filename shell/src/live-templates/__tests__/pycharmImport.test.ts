// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { parsePycharmXml, translatePycharmExpression } from "../pycharmImport";

describe("translatePycharmExpression", () => {
  it("同名函数原样保留", () => {
    expect(translatePycharmExpression('concat(fileName(), " — ", date("yyyy-MM-dd"))')).toBe(
      'concat(fileName(), " — ", date("yyyy-MM-dd"))',
    );
    expect(translatePycharmExpression('enum("A", "B")')).toBe('enum("A", "B")');
  });
  it("映射表重命名", () => {
    expect(translatePycharmExpression('lowercaseAndDash("FooBar")')).toBe('kebabCase("FooBar")');
    expect(translatePycharmExpression("completeSmart()")).toBe("complete()");
    expect(translatePycharmExpression("classNameComplete()")).toBe("complete()");
  });
  it("不支持的函数 → null（调用方降级为默认值）", () => {
    expect(translatePycharmExpression('groovyScript("_1.toUpperCase()", X)')).toBeNull();
    expect(translatePycharmExpression("expectedType()")).toBeNull();
    expect(translatePycharmExpression("djangoBlock()")).toBeNull();
  });
  it("非法表达式 → null", () => {
    expect(translatePycharmExpression("foo(")).toBeNull();
  });
});

describe("parsePycharmXml", () => {
  const XML = `<templateSet group="Python">
  <template name="logf" value="logger.info(&quot;$MSG$&quot;)$END$" description="log">
    <variable name="MSG" expression="" defaultValue="&quot;hello&quot;" alwaysStopAt="true" />
  </template>
  <template name="hdr" value="# $F$ $D$" description="">
    <variable name="F" expression="fileName()" defaultValue="&quot;&quot;" alwaysStopAt="false" />
    <variable name="D" expression="groovyScript(&quot;x&quot;)" defaultValue="&quot;X&quot;" alwaysStopAt="true" />
  </template>
  <template name="bad abbr!" value="x" description="" />
</templateSet>`;

  it("解析模板/变量/降级/错误分流", () => {
    const result = parsePycharmXml(XML);
    expect(result).not.toBeNull();
    expect(result!.templates.map((t) => t.abbreviation)).toEqual(["logf", "hdr"]);
    expect(result!.errors).toHaveLength(1);

    const logf = result!.templates[0];
    expect(logf.body).toBe('logger.info("$MSG$")$END$'); // XML 实体已解码
    expect(logf.variables).toEqual([
      { name: "MSG", expression: undefined, defaultValue: "hello", skipIfDefined: false },
    ]);
    expect(logf.scopes).toEqual(["python:module", "python:class", "python:function"]);
    expect(logf.tabExpand).toBe(true);

    const hdr = result!.templates[1];
    // fileName() 可翻译保留；alwaysStopAt=false → skipIfDefined
    expect(hdr.variables?.[0]).toEqual({
      name: "F",
      expression: "fileName()",
      defaultValue: undefined,
      skipIfDefined: true,
    });
    // groovyScript 不支持 → 降级：表达式去除、默认值保留、记录待人工确认
    expect(hdr.variables?.[1]).toEqual({
      name: "D",
      expression: undefined,
      defaultValue: "X",
      skipIfDefined: false,
    });
    expect(result!.downgraded).toEqual([
      { abbreviation: "hdr", variable: "D", expression: 'groovyScript("x")' },
    ]);
  });

  it("非 XML / 无模板 → null 或空集", () => {
    expect(parsePycharmXml("not xml at all <<<")?.templates ?? []).toEqual([]);
    expect(parsePycharmXml("<templateSet></templateSet>")!.templates).toEqual([]);
  });
});
