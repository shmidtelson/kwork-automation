import axios from 'axios';
import * as fs from "fs";
import { BrowserContext, Page, Cookie } from 'playwright';
import { chromium } from 'playwright';
const cron = require('node-cron');

require('dotenv').config();


const helloMessage = `Приветствую! Я очень рад что вы обратились за помощью именно ко мне! Я отвечу вам сразу, как только смогу! Спасибо за обращение! &#10084;`;
const targetUrl = 'https://kwork.ru/';
const cookiesFile = './cookies.json';
const ATTEMPTS_GETTING_COOKIES = 3;

const reciever = process.env.TELEGRAM_RECIEVER_ID ?? '';
const botToken = process.env.TELEGARM_BOT_TOKEN ?? '';
const kworklogin = process.env.KWORK_LOGIN ?? '';
const kworkpassword = process.env.KWORK_PASSWORD ?? '';

const BUTTON_MODAL_AUTH_SELECTOR = '#app-header-select .login-js';
const AUTH_FORM_SELECTOR = '#form-login-page';
const AUTH_FORM_USERNAME_SELECTOR = '#form-login-page input';
const AUTH_FORM_PASSWORD_SELECTOR = '#form-login-page input[type=password]';
const AUTH_FORM_BUTTON_SUBMIT_SELECTOR = '#form-login-page button';
const CHATS_TABS_SELECTOR = 'ul.chat__list .chat__list-item';
const CHATS_WITH_WARNING_SELECTOR = '.chat__list-message_warning';
const CHAT_MESSAGE_SELECTOR = '.cm-message-html';
const CHAT_INPUT_MESSAGE_SELECTOR = '.trumbowyg-message-body';
const CHAT_SEND_MESSAGE_BUTTON_SELECTOR = '#new-desktop-submit button';

const sendTelegramMessage = async (message: string) => {
    message = message.replaceAll('<p>', '')
    message = message.replaceAll('</p>', '\n');

    const params = {
        chat_id: reciever,
        text: message,
        parse_mode: 'html',
    };

    await axios.get(`https://api.telegram.org/bot${botToken}/sendMessage`, {params})
}

const saveCookies = (cookies: Cookie[]): void => {
    const cookieJson = JSON.stringify(cookies)

    fs.writeFileSync(cookiesFile, cookieJson)
}

const getCookies = (): Cookie[] | null => {
    if (!fs.existsSync(cookiesFile)) return null;
    return JSON.parse(fs.readFileSync(cookiesFile, 'utf8'));
}

const initCookies = async (page: Page, context: BrowserContext, force: boolean = false) => {
    console.info('Init cookies');
    const cookies = getCookies();

    if (cookies && !force) {
        await context.addCookies(cookies);
    }

    if (!cookies || force) {
        console.info('Auth');
        await page.goto(targetUrl);
        await page.waitForTimeout(1000)

        await page.locator(BUTTON_MODAL_AUTH_SELECTOR).click();
        await page.isVisible(AUTH_FORM_SELECTOR);

        console.info('Start filling form')
        await page.locator(AUTH_FORM_USERNAME_SELECTOR).first().fill(kworklogin);
        await page.fill(AUTH_FORM_PASSWORD_SELECTOR, kworkpassword);

        await page.locator(AUTH_FORM_BUTTON_SUBMIT_SELECTOR).click();

        await page.waitForTimeout(1500)

        saveCookies(await context.cookies());
    }
}

const run = async () => {
    console.log('Start task');
    const browser = await chromium.launch();
    const context = await browser.newContext();
    const page: Page = await context.newPage();

    await initCookies(page, context);

    console.info('Went to inbox');
    let currentAttempt = 1;
    while (currentAttempt <= ATTEMPTS_GETTING_COOKIES) {
        await page.goto(`${targetUrl}inbox`);
        if (page.url().endsWith('/login')) {
            await initCookies(page, context, true);
            currentAttempt++;
            continue;
        }
        await page.waitForTimeout(1500)
        break;
    }


    for (const item of await page.locator(CHATS_TABS_SELECTOR,
        {has: await page.locator(CHATS_WITH_WARNING_SELECTOR)}
    ).all()){

        await item.click();
        await page.waitForTimeout(1500)

        // Send message
        const message = await page.locator(CHAT_MESSAGE_SELECTOR).last().innerHTML();
        await sendTelegramMessage(message)

        // Type text
        await page.locator(CHAT_INPUT_MESSAGE_SELECTOR).type(helloMessage);
        await page.locator(CHAT_SEND_MESSAGE_BUTTON_SELECTOR).click();
    }

    await browser.close();
    console.info('DONE')
}

cron.schedule('*/5 * * * *', async () => {
    try {
        await run();
    } catch (e) {
        console.error(e.toString());
    }
});