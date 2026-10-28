# Kazari

Catálogo pessoal self-hosted para organizar objetos por espaços, categorias,
tags e localização. Interface mobile-first, PWA e sincronização offline.

## Desenvolvimento

```sh
cp .env.example .env
cd server && npm install
DATA_DIR=./data JWT_SECRET=dev MASTER_CODE=dev npm run dev
```

Em outro terminal:

```sh
cd web && npm install && npm run dev
```

## Homelab

O container escuta internamente na porta 3000 e usa a rede externa
`media_server_media_net`. Persistência em `./data` (SQLite, imagens e backups).
O hostname `kazari.lab` deve apontar para o proxy reverso. Para PWA e câmera,
configure HTTPS acessível pelos aparelhos conectados à LAN/Tailscale.

Antes de subir, copie `.env.example` para `.env` e defina `JWT_SECRET` e
`MASTER_CODE` fortes. Não versione `.env` nem `data/`.

