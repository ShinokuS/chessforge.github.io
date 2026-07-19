FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev ws && npm install -D tsx typescript @types/node @types/ws
COPY tsconfig.json ./
COPY src ./src
ENV PORT=8787
EXPOSE 8787
CMD ["npx", "tsx", "src/index.ts"]
