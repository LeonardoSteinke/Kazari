# Kazari

Catálogo pessoal mobile-first e offline-first para organizar itens por espaços,
categorias hierárquicas, tags, campos personalizados e localização física.

## Incluído

- Contas isoladas; primeira conta com código master; novas contas por convite de
  uso único e validade de sete dias.
- Vários espaços pessoais por conta, isolados das outras contas da instalação.
- Itens com descrição, múltiplas categorias, tags, localização, campos
  configuráveis e link externo para compra.
- Busca por nome, descrição, tags e campos; filtros por categoria (com opção de
  incluir descendentes), tag e localização.
- Uma imagem por item. Modo otimizado converte para WebP e gera miniatura. Modo
  alta mantém o formato e os bytes enviados quando o arquivo já cabe no limite;
  acima de 10 MB ou para formatos de imagem incompatíveis, redimensiona e
  comprime para WebP até caber. Arquivo de origem pode ter até 25 MB; a cópia
  original não é guardada em paralelo.
- Mensagem de item pelo menu nativo de compartilhamento (WhatsApp, Mensagens,
  etc.). O conteúdo enviado é texto; a imagem e o espaço não são compartilhados.
  Um link interno opcional requer VPN e login na conta proprietária.
- Lixeira recuperável por sete dias, seguida por remoção automática do item e da
  imagem.
- PWA com shell offline, últimas 80 fichas consultadas e miniaturas locais,
  alterações em IndexedDB e fila idempotente para sincronização ao reconectar.
- Verificação de `/api/version` ao abrir, voltar ao app e a cada 15 minutos;
  deploy novo limpa o cache antigo e recarrega a interface sem apagar a fila
  offline.

## Stack

| Camada | Tecnologia |
|---|---|
| Interface | React 18, TypeScript, Vite |
| PWA | vite-plugin-pwa, Workbox e IndexedDB (`idb`) |
| API | Node.js 20, Express, Zod |
| Dados | SQLite via better-sqlite3, modo WAL |
| Imagens | Sharp: WebP, limite de 10 MB e miniatura por foto |
| Autenticação | bcrypt, JWT em cookie HttpOnly/SameSite e rate limit |
| Deploy | Docker multi-stage, um container atrás do nginx-proxy |

## Desenvolvimento

Configure as variáveis locais e instale as dependências:

```sh
cp .env.example .env
cd server && npm ci
DATA_DIR=./data JWT_SECRET=dev-secret MASTER_CODE=dev-master npm run dev
```

Em outro terminal:

```sh
cd web && npm ci && npm run dev
```

O frontend Vite usa proxy de `/api` para `localhost:3000`.

## Homelab e `kazari.lab`

O wildcard `*.lab` do Pi-hole já resolve para o IP Tailscale do host. O Compose
conecta o container à rede `media_server_media_net`, sem publicar porta no
host. Configure o proxy usando [`deploy/nginx-kazari.conf`](deploy/nginx-kazari.conf)
e recarregue o nginx. Esse hostname não deve receber rota no Cloudflare Tunnel.

O bloco fornecido usa um certificado privado para `kazari.lab`. Gere-o com uma
CA local confiável nos celulares (por exemplo, mkcert instalado nos dispositivos)
ou adapte os caminhos para a sua CA interna. O certificado deve conter
`kazari.lab` no SAN e a CA deve ser confiável no aparelho. O HTTPS é necessário
para instalação PWA, service worker e câmera; o endereço segue privado na VPN.

Antes do primeiro deploy:

```sh
cp .env.example .env
openssl rand -hex 32   # definir JWT_SECRET
openssl rand -hex 24   # definir MASTER_CODE
mkdir -p data/media data/backups
```

O container roda como UID 1000 (`node`); assegure que `data/` pertença ao UID
1000 antes de subir. Depois configure os segredos em `.env` e execute:

```sh
docker compose up -d --build
docker compose logs -f
```

Primeiro cadastro em `https://kazari.lab` usa `MASTER_CODE` e vira administrador.
Essa conta gera convites em **Ajustes**. Cada convite é exibido uma vez, vale
sete dias e cria uma conta. Os espaços e as respectivas imagens permanecem
privados para a conta que os criou.

### Dados e cópias de segurança

O volume `./data` contém `kazari.db`, `media/` e `backups/`. Fotos são arquivos
identificados por UUID; miniaturas e originais/versões processadas são gerados
no servidor, e o SQLite guarda metadados e associações. São mantidos sete
snapshots diários do banco. Inclua **todo o diretório `data/`** no backup externo
do homelab para poder restaurar banco e fotos juntos.

### Atualizar

```sh
git pull
docker compose up -d --build
```

## Decisões de sincronização

O shell e os recursos estáticos são precacheados; chamadas autenticadas da API
não são guardadas pelo service worker. O app mantém no IndexedDB as últimas 80
fichas e suas miniaturas e as operações ainda não enviadas, incluindo fotos. Os
envios de criação têm chave idempotente por cliente. A primeira versão aplica
alterações na ordem local e usa a última gravação recebida em edições concorrentes.
Se uma operação pendente receber erro de validação/permissão, ela permanece
indicada como pendente para que o usuário possa corrigir após reconectar.

