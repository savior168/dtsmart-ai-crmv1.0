import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": resolve(".") }, jsx: { runtime: "automatic" } });
const { PiOrderForm } = await jiti.import(resolve("components/pi-order-form.tsx"));
const source = await readFile(new URL("../components/pi-order-form.tsx", import.meta.url), "utf8");
assert.match(source, /选择客户资料中的客户收货信息/, "有客户档案收货信息时须能选择完整联系人条目");
assert.match(source, /收货地址<Required \/><textarea[^>]*value=\{address\} onChange=\{\(event\) => \{ markUnsaved\(\); setAddress\(event\.target\.value\)/, "带入后本单地址仍须允许编辑");
const emptyForm = renderToStaticMarkup(createElement(PiOrderForm, { initialIsClerk: false }));
assert.match(emptyForm, /添加客户收货信息/);
assert.match(emptyForm, /添加货代收货信息/);
assert.match(source, /选择客户资料中的货代收货信息/, "勾选货代收货信息后须能选择客户档案中的货代条目");
assert.match(source, /setRecipient\(chosen\?\.recipient[\s\S]*setPhone\(chosen\?\.phone[\s\S]*setAddress\(chosen\?\.address/, "选择客户资料后须带入整条收货信息，且输入框保持可编辑");
assert.match(source, /setForwarderAddress\(chosen\?\.address[\s\S]*setForwarderRecipient\(chosen\?\.recipient[\s\S]*setForwarderPhone\(chosen\?\.phone/, "选择客户资料后须带入整条货代信息，且输入框保持可编辑");
assert.doesNotMatch(emptyForm, /placeholder="输入或选择客户资料中的收货地址"/, "未勾选时不应直接显示客户收货地址输入框");
assert.doesNotMatch(emptyForm, /从客户资料选择/, "未勾选时不应显示货代选择控件");
console.log("PI single-field delivery address regressions passed.");

