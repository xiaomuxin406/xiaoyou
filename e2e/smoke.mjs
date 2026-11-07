import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
const browser=await chromium.launch({...(process.env.CHROME_TEST_PATH?{executablePath:process.env.CHROME_TEST_PATH}:{}),headless:true});
const page=await browser.newPage({viewport:{width:1440,height:960}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto('http://127.0.0.1:8765');await page.getByText('主人，很高兴再见到你',{exact:true}).waitFor();
await page.screenshot({path:'.runtime/dashboard.png',fullPage:true});
await page.getByLabel('新待办事项').fill('验收本机助手');await page.getByRole('button',{name:'添加待办',exact:true}).click();await page.getByText('验收本机助手',{exact:true}).waitFor();
await page.reload();await page.getByText('验收本机助手',{exact:true}).waitFor();await page.getByRole('button',{name:'完成验收本机助手',exact:true}).click();
await page.getByRole('button',{name:'打开设置',exact:true}).click();await page.getByRole('dialog',{name:'小优设置'}).waitFor();await page.screenshot({path:'.runtime/settings.png',fullPage:true});await page.getByRole('button',{name:'关闭设置',exact:true}).click();
await page.setViewportSize({width:620,height:900});await page.screenshot({path:'.runtime/dashboard-mobile.png',fullPage:true});
assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no horizontal overflow');assert.deepEqual(errors,[]);
await page.getByRole('button',{name:'删除验收本机助手',exact:true}).click();
console.log('PASS: real bundle greeting, todo create/reload/complete/delete, settings, responsive layout, no page errors');await browser.close();

