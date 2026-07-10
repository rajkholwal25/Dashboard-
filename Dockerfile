FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY config ./config
COPY public ./public
COPY services ./services
COPY server.js ./

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3002

EXPOSE 3002

CMD ["npm", "start"]
