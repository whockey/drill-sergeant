FROM node:12.13.0-alpine

RUN mkdir -p /home/node/app/node_modules && chown -R node:node /home/node/app

WORKDIR /home/node/app

COPY package*.json ./

USER node

RUN npm install

RUN npm install typescript

COPY --chown=node:node . .

RUN ./node_modules/typescript/bin/tsc

EXPOSE 8080

CMD [ "node", "index" ]