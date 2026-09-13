FROM node:22-alpine

WORKDIR /app

COPY package*.json ./

RUN npm ci

RUN npm install -g nodemon

COPY . .

CMD ["npm", "run", "dev"]
