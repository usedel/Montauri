// 简体中文语言包聚合入口：各域词条在此展开成一张扁平表，并派生全局 TKey。
//
// 新增域的三步：① 建 `./<domain>.ts` 并 `export const <domain> = {}`；
// ② 在此 import 并在 zhCN 里加一行展开；③ 在 ../../en-US/ 建同名文件并在其 index.ts 展开。
// 展开顺序无关——各域 key 前缀互不相同，重叠会在 tsc 阶段因类型冲突暴露。
import { core } from "./core";
import { debug } from "./debug";
import { dep } from "./dep";
import { env } from "./env";
import { filetree } from "./filetree";
import { git } from "./git";
import { newproject } from "./newproject";
import { run } from "./run";
import { search } from "./search";
import { settings } from "./settings";
import { storage } from "./storage";
import { welcome } from "./welcome";

/** 全量中文词条（真源）：英文包的 Record<TKey, string> 以它为基准做同构校验。 */
export const zhCN = { ...core, ...git, ...debug, ...filetree, ...run, ...env, ...storage, ...dep, ...settings, ...newproject, ...welcome, ...search };

/** 全部文案 key：en-US 的 `Record<TKey, string>` 与 `t()` 的入参类型都从这里派生。 */
export type TKey = keyof typeof zhCN;
