FROM mcr.microsoft.com/playwright:v1.36.0-jammy
RUN apt update -y -qq
RUN apt-get install wget gnupg -y

RUN curl -sL https://deb.nodesource.com/setup_16.x | bash -
RUN apt-get install -y nodejs

RUN npm install --global yarn

WORKDIR /app
COPY package.json .
COPY yarn.lock .
RUN yarn install

COPY . .

CMD yarn start