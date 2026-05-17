import axios from 'axios';
import * as fs from 'fs';
import { Browser, BrowserContext, Cookie, Locator, Page } from 'playwright';
import playwright, { chromium } from 'playwright';

require('dotenv').config();

const helloMessage = `Приветствую! Я очень рад что вы обратились за помощью именно ко мне! Я отвечу вам сразу, как только смогу! Спасибо за обращение! &#10084;`;
const targetUrl = 'https://kwork.ru/';
const cookiesFile = './cookies.json';
const processedStateFile = './processed-chats.json';
const ATTEMPTS_GETTING_COOKIES = 3;
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS) || 45_000;

const reciever = process.env.TELEGRAM_RECIEVER_ID ?? '';
const botToken = process.env.TELEGRAM_BOT_TOKEN ?? process.env.TELEGARM_BOT_TOKEN ?? '';
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

type ProcessedState = Record<string, string>;

let browser: Browser | null = null;
let context: BrowserContext | null = null;
let page: Page | null = null;
let isProcessing = false;
let shouldStop = false;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const sendTelegramMessage = async (message: string) => {
    if (!botToken || !reciever) return;

    message = message.replaceAll('<p>', '').replaceAll('</p>', '\n');

    const params = {
        chat_id: reciever,
        text: message,
        parse_mode: 'html',
    };

    await axios.get(`https://api.telegram.org/bot${botToken}/sendMessage`, { params });
};

const saveCookies = (cookies: Cookie[]): void => {
    fs.writeFileSync(cookiesFile, JSON.stringify(cookies));
};

const getCookies = (): Cookie[] | null => {
    if (!fs.existsSync(cookiesFile)) return null;
    return JSON.parse(fs.readFileSync(cookiesFile, 'utf8'));
};

const loadProcessedState = (): ProcessedState => {
    if (!fs.existsSync(processedStateFile)) return {};
    return JSON.parse(fs.readFileSync(processedStateFile, 'utf8'));
};

const saveProcessedState = (state: ProcessedState): void => {
    fs.writeFileSync(processedStateFile, JSON.stringify(state));
};

const messageFingerprint = (text: string): string => text.trim().replace(/\s+/g, ' ').slice(0, 300);

const alreadySentHello = (text: string): boolean =>
    text.includes('Приветствую!') || text.includes('Спасибо за обращение!');

const getChatId = async (item: Locator): Promise<string> => {
    const href = await item.locator('a').first().getAttribute('href').catch(() => null);
    if (href) return href;

    const dataId = await item.getAttribute('data-id').catch(() => null);
    if (dataId) return dataId;

    return (await item.innerText()).trim().slice(0, 120);
};

const initCookies = async (targetPage: Page, targetContext: BrowserContext, force = false) => {
    console.info('Init cookies');
    const cookies = getCookies();

    if (cookies && !force) {
        await targetContext.addCookies(cookies);
    }

    if (!cookies || force) {
        console.info('Auth');
        await targetPage.goto(targetUrl);
        await targetPage.waitForSelector(BUTTON_MODAL_AUTH_SELECTOR, { timeout: 15_000 });

        await targetPage.locator(BUTTON_MODAL_AUTH_SELECTOR).click();
        await targetPage.waitForSelector(AUTH_FORM_SELECTOR, { timeout: 15_000 });

        console.info('Start filling form');
        await targetPage.locator(AUTH_FORM_USERNAME_SELECTOR).first().fill(kworklogin);
        await targetPage.fill(AUTH_FORM_PASSWORD_SELECTOR, kworkpassword);
        await targetPage.locator(AUTH_FORM_BUTTON_SUBMIT_SELECTOR).click();

        await targetPage.waitForURL((url) => !url.pathname.endsWith('/login'), { timeout: 20_000 }).catch(() => {});
        saveCookies(await targetContext.cookies());
    }
};

const openInbox = async (): Promise<boolean> => {
    if (!page || !context) return false;

    for (let attempt = 1; attempt <= ATTEMPTS_GETTING_COOKIES; attempt++) {
        await page.goto(`${targetUrl}inbox`, { waitUntil: 'domcontentloaded' });

        if (!page.url().includes('/login')) {
            await page.waitForSelector(CHATS_TABS_SELECTOR, { timeout: 20_000 }).catch(() => {});
            return true;
        }

        console.info(`Session expired, re-auth attempt ${attempt}`);
        await initCookies(page, context, true);
    }

    return false;
};

const processUnreadChats = async () => {
    if (!page) return;

    const processedState = loadProcessedState();
    const unreadChats = page
        .locator(CHATS_TABS_SELECTOR)
        .filter({ has: page.locator(CHATS_WITH_WARNING_SELECTOR) });

    const chatItems = await unreadChats.all();
    if (!chatItems.length) {
        console.info('No unread chats');
        return;
    }

    console.info(`Unread chats: ${chatItems.length}`);

    for (const item of chatItems) {
        const chatId = await getChatId(item);
        await item.click();
        await page.waitForSelector(CHAT_MESSAGE_SELECTOR, { timeout: 10_000 }).catch(() => {});

        const lastMessage = page.locator(CHAT_MESSAGE_SELECTOR).last();
        const lastMessageText = (await lastMessage.innerText().catch(() => '')).trim();
        const fingerprint = messageFingerprint(lastMessageText);

        if (!fingerprint) continue;
        if (processedState[chatId] === fingerprint) continue;

        const lastMessageHtml = await lastMessage.innerHTML().catch(() => lastMessageText);
        await sendTelegramMessage(lastMessageHtml);

        if (!alreadySentHello(lastMessageText)) {
            await page.locator(CHAT_INPUT_MESSAGE_SELECTOR).fill(helloMessage);
            await page.locator(CHAT_SEND_MESSAGE_BUTTON_SELECTOR).click();
            console.info(`Auto-reply sent: ${chatId}`);
        } else {
            console.info(`Skip auto-reply, already answered: ${chatId}`);
        }

        processedState[chatId] = fingerprint;
        saveProcessedState(processedState);
        await sleep(500);
    }
};

const processInbox = async () => {
    if (!page) return;

    const inboxOpened = await openInbox();
    if (!inboxOpened) {
        console.error('Failed to open inbox');
        return;
    }

    await processUnreadChats();
};

const initBrowser = async () => {
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext();
    page = await context.newPage();
    await initCookies(page, context);
};

const shutdown = async () => {
    shouldStop = true;
    await browser?.close();
    browser = null;
    context = null;
    page = null;
};

const runLoop = async () => {
    await initBrowser();
    console.info(`Polling inbox every ${POLL_INTERVAL_MS / 1000}s`);

    while (!shouldStop) {
        if (!isProcessing) {
            isProcessing = true;
            try {
                await processInbox();
            } catch (error) {
                if (error instanceof playwright.errors.TimeoutError) {
                    console.error('Timeout while processing inbox');
                } else {
                    console.error(error);
                }
            } finally {
                isProcessing = false;
            }
        } else {
            console.warn('Previous poll still running, skip tick');
        }

        await sleep(POLL_INTERVAL_MS);
    }
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

runLoop().catch(async (error) => {
    console.error(error);
    await shutdown();
    process.exit(1);
});
