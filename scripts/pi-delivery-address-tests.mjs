import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": resolve(".") }, jsx: { runtime: "automatic" } });
const { PiDeliveryAddressField } = await jiti.import(resolve("components/pi-order-form.tsx"));
const source = await readFile(new URL("../components/pi-order-form.tsx", import.meta.url), "utf8");
const render = (value, options) => renderToStaticMarkup(createElement(PiDeliveryAddressField, { value, options, onChange: () => {} }));

const withOptions = render("地址二", ["地址一", "地址二"]);
assert.match(withOptions, /id="pi-delivery-address"[^>]*value="地址二"/, "当前 PI 地址必须留在唯一输入框中");
assert.match(withOptions, /aria-label="选择客户收货地址"/, "已保存地址应在输入框内提供选择按钮");
assert.equal((withOptions.match(/id="pi-delivery-address"/g) || []).length, 1, "不得产生第二行地址输入控件");
assert.doesNotMatch(withOptions, /<select/, "不应再用第二行下拉框挤高表单");
assert.doesNotMatch(render("自定义地址", []), /选择客户收货地址/, "无已保存地址时仅展示自由输入框");
assert.match(source, /onClick=\{\(\) => \{ onChange\(item\); setOpen\(false\); \}\}/, "选择地址应直接填入同一字段");
assert.match(source, /PiDeliveryAddressField value=\{address\} options=\{selectedShippingAddresses\} onChange=\{\(value\) => \{ markUnsaved\(\); setAddress\(value\); const selected = selectedShippingContacts\.find/, "选择及手工输入都须更新PI地址并标记未保存，同时匹配对应收货人和电话");
assert.doesNotMatch(source, /<AppSelect aria-label="选择客户收货地址"/, "不得保留旧第二行地址下拉框");
console.log("PI single-field delivery address regressions passed.");
