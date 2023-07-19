import { Page } from "@playwright/test";
import axios from 'axios';
const playwright = require('playwright');
require('dotenv').config();

const helloMessage = `Приветствую! Я очень рад что вы обратились за помощью именно ко мне! Я отвечу вам сразу, как только смогу! Спасибо за обращение! &#10084;`;

const reciever = process.env.TELEGRAM_RECIEVER_ID ?? '';
const botToken = process.env.TELEGARM_BOT_TOKEN ?? '';
const kworklogin = process.env.KWORK_LOGIN ?? '';
const kworkpassword = process.env.KWORK_PASSWORD ?? '';

const sendTelegramMessage = async (message: string) => {
    const params = {
        chat_id: reciever,
        text: message,
    };

    await axios.get(`https://api.telegram.org/bot${botToken}/sendMessage`, {params})
}

(async () => {
    const browser = await playwright['firefox'].launch({
        // headless: false,
    });
    const context = await browser.newContext();
    const page: Page = await context.newPage();

    await page.goto('https://kwork.ru/');
    await page.waitForTimeout(1000)

    await page.locator('#app-header-select .login-js').click();
    await page.isVisible('#form-login-page');

    console.info('Start filling form')
    await page.locator('#form-login-page input').first().fill(kworklogin);
    await page.fill('#form-login-page input[type=password]', kworkpassword);

    await page.locator('#form-login-page button').click();
    console.log('Went to inbox');
    await page.waitForTimeout(1500)
    await page.goto('https://kwork.ru/inbox');
    await page.waitForTimeout(1500)

    for (const item of await page.locator('ul.chat__list .chat__list-item',
        {has: await page.locator('.chat__list-message_warning')}
    ).all()){
        const message = await item.locator('.chat__list-message').innerText();
        await sendTelegramMessage(message)

        await item.click();
        await page.waitForTimeout(1500)

        await page.locator('.trumbowyg-message-body').type(helloMessage);
        await page.locator('#new-desktop-submit button').click();
    }

    await browser.close();
    console.info('DONE')
})();