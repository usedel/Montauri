# PyCharm Live Templates 功能全景调研

> 本文档为纯功能调研，旨在完整梳理 PyCharm Live Templates（实时模板）的能力体系，作为参考设计的素材库。不涉及具体实现决策。

## 1. 产品定位与交互模型

Live Templates 是 JetBrains 系列 IDE 中用于**快速插入常用代码结构**的核心功能。用户在编辑器中输入一个缩写（abbreviation），按下展开键（默认 `Tab`），IDE 即将缩写替换为预定义的代码片段。

其核心交互闭环为：

1. **输入缩写** → 2. **按 `Tab` 展开** → 3. **在模板变量间跳转（继续按 `Tab`）** → 4. **`$END$` 标记处结束跳转**
5. 反向跳转可按 `Shift+Tab`

这套"缩写—展开—变量跳转—结束"的极简闭环，是 Live Templates 被广泛认为"优秀"的根本原因——它把"插入代码片段"这个动作压缩到了两次按键以内。

## 2. 模板类型

PyCharm 将 Live Templates 分为以下类型：

### 2.1 简单模板（Simple Templates）
仅包含固定纯文本。展开时文本自动插入源代码，替换掉缩写。

### 2.2 参数化模板（Parameterized Templates）
包含允许用户输入的**变量**。展开时，变量要么显示为供用户手动输入的字段，要么由 PyCharm 通过表达式自动计算。

### 2.3 环绕模板（Surround Templates）
使用用户指定的文本包裹所选代码块。例如 `T` 模板展开为一对标签，可以为标签指定名称。也可以选中一段代码，按 `Ctrl+Alt+T` 打开"Select Template"弹出窗口，选择 `T` 模板，用一对标签包裹所选内容。

### 2.4 后缀补全（Postfix Completion）
与 Live Templates 类似，但**无需选择即可转换当前表达式**。例如，在表达式后键入 `.if` 以调用相应的后缀补全，将该表达式包裹在 if 语句中。

> 📌 **Live Templates 与 Postfix 的关键区别**：Live Templates 插入预定义代码片段；Postfix Completion 包裹或修改已有表达式。

## 3. 模板的组织：分组与作用域

在 `Settings | Editor | Live Templates` 设置页面中：

- 模板按**可使用上下文**进行分组（通常按相应语言）
- 要将模板移动到其他组，右键点击该模板，选择"Move"，然后选择所需的组名
- 每个 Live Template 都由包含字母数字字符、点和连字符的缩写来定义
- **缩写在同一组内必须唯一**，但相同的缩写可以在不同的组中使用，并根据相应组的上下文展开为不同的结构

## 4. 变量与表达式引擎（核心）

### 4.1 变量声明语法

在模板中使用 `$VAR$` 格式声明变量。若要在模板文本中加入字面量 `$` 字符以避免被当作变量声明，使用特殊变量 `$$`。

### 4.2 预定义模板变量（不可修改）

PyCharm 支持以下预定义 Live Template 变量：

| 变量 | 含义 |
|---|---|
| `$END$` | 代码片段完成时脱字符号的位置，此时不再按 Tab 跳转到下一个变量 |
| `$SELECTION$` | 用于环绕模板，表示要被包裹的代码片断 |

### 4.3 变量配置（Edit Variables 对话框）

对于每个变量，可以：

- 修改变量名
- 使用预定义函数定义表达式
- 为表达式求值失败的情况指定默认值（默认值应包含在双引号中）
- 指定如果表达式成功求值，是否在提示用户输入时跳过该变量

### 4.4 表达式中可用的构造

表达式可以包含：

- 双引号中的字符串常量
- Live Template 中定义的其他变量名
- 带参数的预定义函数

## 5. 预定义函数全集

以下是 PyCharm Live Templates 变量中可用的函数全集。按功能分类列出：

### 5.1 字符串转换函数

| 函数 | 描述 |
|---|---|
| `camelCase()` | 将字符串转换为 camelCase。如 `camelCase("my-text-file")` 返回 `myTextFile` |
| `capitalize()` | 将字符串首字母大写。如 `capitalize("name")` 返回 `Name` |
| `capitalizeAndUnderscore()` | 将字符串所有字母大写，并在各部分之间插入下划线。如 `capitalizeAndUnderscore("FooBar")` 返回 `FOO_BAR` |
| `decapitalize()` | 将字符串首字母替换为相应的小写字母 |
| `snakeCase()` | 将字符串转换为 snake_case |
| `lowercaseAndDash()` | 将字符串转换为小写并用短横线分隔。如 `lowercaseAndDash(MyExampleName)` 返回 `my-example-name` |
| `spaceSeparated()` | 将字符串转换为小写并插入空格作为分隔符 |
| `spacesToUnderscores()` | 将字符串中的空格替换为下划线 |
| `underscoresToCamelCase()` | 将字符串中的下划线替换为 camelCase 字母 |
| `underscoresToSpaces()` | 将字符串中的下划线替换为空格 |
| `firstWord()` | 返回参数字符串的第一个词 |

### 5.2 文件上下文函数

| 函数 | 描述 |
|---|---|
| `fileName()` | 返回当前文件名（含扩展名） |
| `fileNameWithoutExtension()` | 返回当前文件名（不含扩展名） |
| `filePath()` | 返回当前文件的绝对路径 |
| `fileRelativePath()` | 返回相对于当前项目的文件路径 |

### 5.3 代码上下文函数

| 函数 | 描述 |
|---|---|
| `className()` | 返回当前类的名称（模板在其中展开） |
| `qualifiedClassName()` | 返回当前类的全限定名 |
| `methodName()` | 返回当前方法的名称 |
| `methodParameters()` | 返回当前方法的参数列表 |
| `methodReturnType()` | 返回当前方法的返回类型 |
| `annotated()` | 返回带有指定限定名的注解的类、方法或字段 |
| `blockCommentStart()` | 返回当前语言上下文中指示块注释开始的字符 |
| `blockCommentEnd()` | 返回当前语言上下文中指示块注释结束的字符 |
| `lineCommentStart()` | 返回当前语言上下文中指示行注释开始的字符 |
| `commentStart()` | 返回当前语言上下文中指示注释开始的字符 |
| `commentEnd()` | 返回当前语言上下文中指示注释结束的字符 |

### 5.4 补全与智能感知函数

| 函数 | 描述 |
|---|---|
| `complete()` | 在变量位置调用代码补全 |
| `completeSmart()` | 在变量位置调用智能类型补全 |
| `classNameComplete()` | 在变量位置替代类名补全 |
| `enum("Foo","Bar","Baz")` | 返回模板展开时建议补全的字符串列表 |
| `defaultReturnValues` | 如果表达式用于 return 语句，则返回默认值 |

### 5.5 时间与用户信息函数

| 函数 | 描述 |
|---|---|
| `date([format])` | 返回当前系统日期，支持 SimpleDateFormat 格式 |
| `time([format])` | 返回当前系统时间 |
| `user()` | 返回当前用户名 |
| `clipboard()` | 返回系统剪贴板的内容 |
| `lineNumber()` | 返回当前行号 |

### 5.6 字符串操作函数

| 函数 | 描述 |
|---|---|
| `concat(expressions...)` | 返回传入函数的所有字符串的连接 |
| `regularExpression(String, Pattern, Replacement)` | 根据指定模式替换字符串 |
| `substringBefore(String, Delimiter)` | 删除指定分隔符后的扩展名，仅返回文件名 |
| `escapeString()` | 转义特殊字符以便用于 Java 字符串 |
| `collectionElementName()` | 移除 `_list` 和复数结尾 (s) |

### 5.7 类型推断函数

| 函数 | 描述 |
|---|---|
| `expectedType()` | 返回模板展开处的期望类型（在赋值的右侧、return 之后等） |
| `typeOfVariable()` | 返回作为参数传递的变量的类型 |
| `variableOfType()` | 建议可分配给作为参数传递的类型的所有变量 |

### 5.8 Django 专有函数

| 函数 | 描述 |
|---|---|
| `djangoBlock` | 显示可用 Django blocks 的补全弹出窗口 |
| `djangoFilter` | 显示可用 Django filters 的补全弹出窗口 |
| `djangoTemplateTags` | 显示可用 Django template tags 的补全弹出窗口 |
| `djangoVariable` | 显示可用 Django variable 的补全弹出窗口 |

### 5.9 动态脚本函数

| 函数 | 描述 |
|---|---|
| `groovyScript("script", [arg, ...])` | 执行作为字符串传入的 Groovy 脚本 |

`groovyScript()` 是最强大的扩展点：

- 第一个参数是字符串，内容为脚本文本或包含该脚本的文件路径
- 其他可选参数作为 `_1, _2, _3, ..., _n` 变量的值传递给脚本
- 在脚本内部可以使用 `_editor` 变量访问当前编辑器

**示例 1**：将给定字符串转换为大写字母

```groovy
groovyScript("_1.toUpperCase()", MyVar)
```

**示例 2**：将所选文本拆分为单词并显示为编号列表

```groovy
groovyScript("def result = ''; _1.split().eachWithIndex{ item, index -> result = result + index.next() + '. ' + item + System.lineSeparator() }; return result;", SELECTION)
```

## 6. Surround Templates（环绕模板）

环绕模板使用 `$SELECTION$` 变量来表示要被包裹的代码片断。

**使用方式**：

1. 选中代码中的 EXAMPLE
2. 通过分配的缩写调用 `"$SELECTION$"` 模板，或按 `Ctrl+Alt+T` 并从列表中选择所需模板
3. 模板展开后，会按模板中的指定包裹所选文本。例如，将 EXAMPLE 包裹在双引号中：`"EXAMPLE"`

## 7. Postfix Completion（后缀补全）

### 7.1 核心机制

通过后缀（dot 之后的符号组合）基于表达式的类型及其上下文将其转换为不同的表达式。

### 7.2 配置

在 `Settings | Editor | General | Postfix Completion` 中：

- 选择"Enable postfix completion"复选框
- 为选定语言启用或禁用 postfix 模板
- 设置 `Tab`、`Space` 或 `Enter` 键来展开 postfix 模板

### 7.3 使用方式

键入一个表达式，然后在 dot 后键入 postfix。例如，键入 `.if` 然后按 Tab。

**示例**：

```
Before: def f(a): a.if
After:  def f(a): if a:
```

### 7.4 自定义 Postfix 模板

在 `Settings | Editor | General | Postfix Completion` 中点击"Add"按钮，指定：

- **Key**：调用模板的 dot 后符号组合
- **表达式类型**：新模板将适用的表达式类型
- **目标表达式**：格式为 `$EXPR$`，例如 `[x for x in $EXPR$]`
- **`$END$`**：模板应用后脱字符号放置的位置

还可选择"Apply to the topmost expression"复选框，让 PyCharm 在调用模板时自动转换最顶层的适用表达式。

### 7.5 常用 Postfix 模板（PyCharm 内置）

- `.if`：生成 if 语句
- `.else`：生成 else 语句
- `.for`：生成 for 循环
- `.try`：生成 try-except 语句
- `.notnull`：生成 `if variable is not None` 语句
- `.null`：生成 `if variable is None` 语句

### 7.6 共享 Postfix 模板

- 使用 Backup and Sync 插件同步模板及其设置在 IDE 之间
- 从一个 IDE 手动导出 postfix 模板并导入到另一个 IDE

## 8. 模板的导入导出与共享

PyCharm 提供多种方式共享 Live Templates 和 Postfix 模板：

- 使用 Backup and Sync 插件在 IDE 之间同步模板及其设置
- 从一个 IDE 手动导出模板并导入到另一个 IDE

## 9. 内置 Python 模板示例

PyCharm 为 Python 提供了一组内建 Live Templates，覆盖常见编码模式。用户可以在 `Settings | Editor | Live Templates` 中浏览所有可用的实时模板。

## 10. 功能亮点总结

### 10.1 为什么 Live Templates 被认为是优秀的

1. **极简交互闭环**：缩写—展开—变量跳转—结束，两次按键完成复杂结构插入
2. **表达式引擎**：预定义函数 + 变量组合，使模板具备上下文感知能力
3. **`groovyScript()` 扩展机制**：允许用户通过 Groovy 脚本实现任意复杂的动态计算
4. **作用域/分组管理**：按语言、按上下文组织模板，避免缩写冲突
5. **环绕 + 后缀补全**：三种互补的代码生成范式（插入、环绕、转换）
6. **可共享**：支持导出导入和云同步

### 10.2 设计上的精妙之处

- **`$END$` 与 `$SELECTION$` 作为特殊变量**：前者定义了展开后的最终光标位置，后者打通了"环绕模板"的能力
- **"Skip if defined"选项**：表达式求值时若已有值，可跳过用户手动输入，实现"零交互展开"
- **默认值机制**：表达式求值时如果失败，提供默认值，保证模板在任何上下文都能展开
- **Django 一等支持**：`djangoBlock` / `djangoFilter` / `djangoTemplateTags` / `djangoVariable` 四个专有函数，体现了 JetBrains 对框架深度集成的一贯思路

### 10.3 与其他 JetBrains IDE 的函数差异

不同 JetBrains IDE 根据语言特性提供了不同的预定义函数。例如：

- **IntelliJ IDEA（Java/Kotlin）** 提供：`arrayVariable()`、`castToLeftSideType()`、`className()`、`expectedType()`、`rightSideType()`、`descendantClassEnum()`、`subtypes()` 等
- **JavaScript/TypeScript** 提供：`jsClassName()`、`jsMethodName()`、`jsQualifiedClassName()`、`jsSuggestVariableName()` 等
- **PyCharm** 特有的：`djangoBlock`、`djangoFilter`、`djangoTemplateTags`、`djangoVariable`

这种"核心函数集 + 语言专有函数"的分层设计，使得 Live Templates 既能保持跨语言一致性，又能深度适配特定语言生态。

## 11. 参考的内建模板模式

虽然 PyCharm 的内建模板具体内容不在本文档范围内详列，但从官方文档可知其覆盖了：

- 循环结构
- 条件语句
- 声明
- print 语句
- 环绕模板（如 `T` 标签）

这些内建模板体现了"将常用结构插入到代码中"的设计理念。

---

> 📌 **调研要点**：PyCharm Live Templates 的优秀不仅在于"缩写展开"这一交互形式，更在于其**表达式引擎的丰富度**（`groovyScript` 提供了图灵完备的扩展能力）和**三种互补范式**（Live Templates 插入、Surround 环绕、Postfix 转换）的有机结合。任何参考设计都应至少覆盖这三层能力，并在表达式引擎的"预定义函数 + 动态脚本"双层架构上给予充分重视。
