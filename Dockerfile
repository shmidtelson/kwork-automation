FROM node:16-alpine

RUN apk update && apk add --no-cache bash \
        chromium \
        chromium-chromedriver

WORKDIR /app
COPY package.json .
COPY yarn.lock .
RUN yarn install

COPY . .

# Add the cron job
RUN echo "*/5 * * * * ts-node /app/kwork.ts > /proc/1/fd/1 2>/proc/1/fd/2" >> /var/spool/cron/crontabs/root

# Link cron log file to stdout
RUN ln -s /dev/stdout /var/log/cron

# Run the cron service in the foreground
CMD crond -f
