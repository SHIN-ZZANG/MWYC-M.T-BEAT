# 의존성 없는 Node 서버 — 설치 · 빌드 단계 없이 소스만 복사해 실행한다
FROM node:24-alpine
# alpine 에는 tzdata 가 없어 TZ 만으로는 한국 시간이 적용되지 않는다
RUN apk add --no-cache tzdata
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV TZ=Asia/Seoul
COPY --chown=node:node . .
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3000
CMD ["node", "src/server.js"]
